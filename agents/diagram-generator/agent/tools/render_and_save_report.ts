import { defineTool } from "eve/tools";
import { z } from "zod";

import { modelIdFor } from "shared/lib/model.js";
import { writeRunArtifact } from "shared/lib/run.js";
import { buildRunSummary } from "shared/lib/summary.js";

// ── Deterministic report assembly (no LLM) ─────────────────────────────────
//
// See openspec/adr/0001-shared-agent-runtime-kit.md §2 and §5. Replaces the
// former `reporter` LLM subagent: report assembly is arithmetic + templating,
// so it lives in a code tool. Reads the persisted phase traces (orchestrate +
// every render-<variation>) + run-meta.json from the sandbox run folder,
// computes timing from the traces and token/cost totals from the shared usage
// hook + cost matrix, and writes report.md + summary.json (mirrored to host +
// sandbox).

interface PhaseTrace {
  phase?: string;
  variation?: string | null;
  model?: string | null;
  // Orchestrate uses started_at/ended_at + tokens; render uses started/ended + usage.
  started_at?: string;
  ended_at?: string;
  started?: string;
  ended?: string;
  duration_s?: number;
  tokens?: { input?: number | null; output?: number | null; total?: number | null; source?: string };
  usage?: { input?: number | null; output?: number | null; total?: number | null; source?: string };
  qc?: { passed?: boolean; iterations?: number; notes?: string; issues_fixed?: string[] };
}

const inputSchema = z.object({
  run_dir: z
    .string()
    .describe("The run directory, e.g. runs/2026-06-20T15-14-27Z"),
  run_id: z.string().min(1).describe("The run id (the timestamp folder name)"),
  allow_cost: z
    .boolean()
    .optional()
    .describe("Override ALLOW_COST. Defaults to env ALLOW_COST !== 'false'."),
});

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "content" in value) {
    const content = (value as { content: unknown }).content;
    if (typeof content === "string") return content;
  }
  return String(value ?? "");
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function fmtDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "n/a";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem === 0 ? `${m}m` : `${m}m ${rem}s`;
}

function startOf(trace?: PhaseTrace): string | undefined {
  return trace?.started_at ?? trace?.started;
}

function endOf(trace?: PhaseTrace): string | undefined {
  return trace?.ended_at ?? trace?.ended;
}

function tokensOf(trace?: PhaseTrace) {
  const t = trace?.tokens ?? trace?.usage;
  const input = num(t?.input);
  const output = num(t?.output);
  const total = num(t?.total) || input + output;
  const source = t?.source ?? "unavailable";
  return { input, output, total, source };
}

export default defineTool({
  description:
    "Deterministically assemble report.md and summary.json from the persisted " +
    "phase traces (orchestrate + render-<variation>) and run-meta.json. Computes " +
    "timing from the traces and token/cost totals from the shared usage hook + " +
    "cost matrix. No LLM. Call after every renderer has returned and the " +
    "orchestrate trace has been written.",
  inputSchema,

  async execute({ run_dir, run_id, allow_cost }, ctx) {
    const startedAtTool = new Date().toISOString();
    const sandbox = await ctx.getSandbox();
    const allowCost =
      allow_cost ?? (process.env.ALLOW_COST ?? "true").toLowerCase() !== "false";

    const readJson = async <T>(relative: string): Promise<T | undefined> => {
      try {
        const raw = textOf(
          await sandbox.readTextFile({ path: `/workspace/${run_dir}/${relative}` }),
        );
        return JSON.parse(raw) as T;
      } catch {
        return undefined;
      }
    };

    const meta = (await readJson<Record<string, unknown>>("run-meta.json")) ?? {};
    const orchestrate = await readJson<PhaseTrace>("phases/orchestrate.json");

    const models = (meta.models as Record<string, string> | undefined) ?? {};
    const orchestratorModel = models.orchestrator ?? modelIdFor("orchestrator");
    const rendererModel = models.renderer ?? modelIdFor("renderer");
    const request = typeof meta.request === "string" ? meta.request : "";

    // ── Discover render-<variation>.json phase traces ───────────────────────
    let variations: string[] = [];
    try {
      const ls = await sandbox.run({
        command: `ls "${run_dir}/phases" 2>/dev/null || true`,
      });
      variations = ls.stdout
        .split(/\s+/)
        .map((name) => /^render-(.+)\.json$/.exec(name.trim())?.[1])
        .filter((v): v is string => Boolean(v));
    } catch {
      variations = [];
    }
    if (variations.length === 0) {
      const opt = (meta.options as Record<string, unknown> | undefined)?.variations;
      if (typeof opt === "string" && opt.trim()) {
        variations = opt.split(",").map((v) => v.trim()).filter(Boolean);
      } else {
        variations = ["default"];
      }
    }

    const renderTraces = await Promise.all(
      variations.map(async (variation) => ({
        variation,
        trace: await readJson<PhaseTrace>(`phases/render-${variation}.json`),
      })),
    );

    const out_name =
      (typeof (meta.options as Record<string, unknown> | undefined)?.out_name ===
      "string"
        ? ((meta.options as Record<string, string>).out_name as string)
        : undefined) ?? "diagram";

    // ── Timing ──────────────────────────────────────────────────────────────
    const endedAtTool = new Date().toISOString();
    const reportDuration = Math.max(
      0,
      Math.round((Date.parse(endedAtTool) - Date.parse(startedAtTool)) / 1000),
    );

    const perPhase: Record<string, number> = {
      orchestrate: num(orchestrate?.duration_s),
      report: reportDuration,
    };
    for (const { variation, trace } of renderTraces) {
      perPhase[`render-${variation}`] = num(trace?.duration_s);
    }
    const computeSeconds = Object.values(perPhase).reduce((a, b) => a + b, 0);

    const allStamps = [
      startOf(orchestrate),
      endOf(orchestrate),
      ...renderTraces.flatMap(({ trace }) => [startOf(trace), endOf(trace)]),
      startedAtTool,
      endedAtTool,
    ]
      .filter((v): v is string => typeof v === "string")
      .map((v) => Date.parse(v))
      .filter((v) => Number.isFinite(v));
    const wallSeconds =
      allStamps.length > 0
        ? Math.round((Math.max(...allStamps) - Math.min(...allStamps)) / 1000)
        : computeSeconds;

    // ── Tokens (per-phase, from the traces) ─────────────────────────────────
    let tokIn = 0;
    let tokOut = 0;
    let anyRuntime = false;
    const tokenRows: string[] = [];
    const pushTokenRow = (label: string, trace?: PhaseTrace) => {
      const t = tokensOf(trace);
      if (t.source === "runtime") {
        tokIn += t.input;
        tokOut += t.output;
        anyRuntime = true;
      }
      tokenRows.push(`| ${label} | ${t.input} | ${t.output} | ${t.total} | ${t.source} |`);
    };
    pushTokenRow("Orchestrate", orchestrate);
    for (const { variation, trace } of renderTraces) {
      pushTokenRow(`Render (${variation})`, trace);
    }
    const tokenNote = anyRuntime
      ? ""
      : "_Note: runtime did not report token usage — timing only._";

    // ── Run metrics: authoritative token + cost totals from the shared kit ──
    const stepBudget = Number.parseInt(process.env.RUN_STEP_BUDGET ?? "", 10);
    const wallBudget = Number.parseInt(
      process.env.RUN_WALL_CLOCK_BUDGET_S ?? "",
      10,
    );
    const summary = buildRunSummary({
      runId: run_id,
      models: { orchestrator: orchestratorModel, renderer: rendererModel },
      fallbackModelId: orchestratorModel,
      budget: {
        steps: Number.isFinite(stepBudget) ? stepBudget : undefined,
        wallClockSeconds: Number.isFinite(wallBudget) ? wallBudget : undefined,
      },
    });

    // ── Cost table ──────────────────────────────────────────────────────────
    const costRated = allowCost && summary.cost.rated;
    const currency = summary.cost.currency ?? "USD";
    const costRows = costRated
      ? summary.cost.byModel.map(
          (model) =>
            `| ${model.modelId} | ${currency} ${model.amount.toFixed(6)} |`,
        )
      : ["| — | n/a |"];
    const costTotal = costRated
      ? `${currency} ${summary.cost.amount.toFixed(6)}`
      : "n/a";
    const costNote = !allowCost
      ? "Cost computation disabled (allow_cost=false)."
      : summary.cost.rated
        ? "Rates are estimates from the cost rate-card; verify against your provider."
        : "No rate-card entry for the configured model(s); tokens recorded, cost marked n/a.";

    // ── Quality check + status ──────────────────────────────────────────────
    const qcLines: string[] = [];
    let allPassed = true;
    for (const { variation, trace } of renderTraces) {
      const passed = trace?.qc?.passed ?? false;
      if (!passed) allPassed = false;
      const mark = passed ? "✅ passed" : "⚠️ failed";
      const notes = trace?.qc?.notes ? ` — ${trace.qc.notes}` : "";
      const iters =
        typeof trace?.qc?.iterations === "number"
          ? ` (${trace.qc.iterations} iteration${trace.qc.iterations === 1 ? "" : "s"})`
          : "";
      qcLines.push(`- **${variation}:** ${mark}${iters}${notes}`);
    }
    if (qcLines.length === 0) qcLines.push("- _No render traces found._");
    const status = allPassed ? "ok" : "partial";

    // ── Artifacts ───────────────────────────────────────────────────────────
    const single = variations.length === 1 && variations[0] === "default";
    const artifacts: string[] = ["spec.json"];
    for (const variation of variations) {
      const base = single ? out_name : `${out_name}-${variation}`;
      artifacts.push(`${base}.html`, `${base}.preview.png`);
    }
    artifacts.push("report.md", "summary.json");
    const artifactLinks = artifacts.map((name) => `- \`${name}\``).join("\n");

    // ── Render report.md ────────────────────────────────────────────────────
    const renderTimeRows = renderTraces.map(
      ({ variation }) =>
        `| Render (${variation}) | ${fmtDuration(perPhase[`render-${variation}`])} |`,
    );

    const lines: string[] = [
      `# Diagram Run Report — ${run_id}`,
      "",
      `**Status:** ${status}  ·  **Variations:** ${variations.join(", ")}  ·  **Generated:** ${endedAtTool}`,
      "",
      `> Request: ${request || "n/a"}`,
      "",
      "## Models",
      "| Phase | Model |",
      "|---|---|",
      `| Orchestrator | ${orchestratorModel} |`,
      `| Renderer | ${rendererModel} |`,
      "",
      "## Execution time",
      "| Phase | Duration |",
      "|---|---|",
      `| Orchestrate (spec + coordination) | ${fmtDuration(perPhase.orchestrate)} |`,
      ...renderTimeRows,
      `| Report | ${fmtDuration(perPhase.report)} |`,
      `| **Wall-clock total** | **${fmtDuration(wallSeconds)}** |`,
      "",
      `_Compute-seconds (sum of phases, ignores parallelism): ${computeSeconds}_`,
      "",
      "## Token consumption",
      "| Phase | Input | Output | Total | Source |",
      "|---|---:|---:|---:|---|",
      ...tokenRows,
      `| **Total** | **${tokIn}** | **${tokOut}** | **${tokIn + tokOut}** | ${anyRuntime ? "runtime" : "unavailable"} |`,
      "",
      ...(tokenNote ? [tokenNote, ""] : []),
      "## Token cost",
      "| Model | Cost |",
      "|---|---:|",
      ...costRows,
      `| **Total** | **${costTotal}** |`,
      "",
      `_${costNote}_`,
      "",
      "## Quality check",
      ...qcLines,
      "",
      "## Artifacts",
      artifactLinks,
      "",
      "---",
      "<sub>Rates are estimates from the shared cost rate-card; verify against your provider. Timing is wall-clock UTC. Generated deterministically — no LLM.</sub>",
      "",
    ];
    const markdown = `${lines.join("\n").trim()}\n`;

    const reportFile = await writeRunArtifact(ctx, run_id, "report.md", markdown);
    const summaryFile = await writeRunArtifact(
      ctx,
      run_id,
      "summary.json",
      JSON.stringify(summary, null, 2) + "\n",
    );

    // ── Record this tool's own phase trace ──────────────────────────────────
    const reportTrace: PhaseTrace = {
      phase: "report",
      variation: null,
      model: "deterministic",
      started_at: startedAtTool,
      ended_at: endedAtTool,
      duration_s: reportDuration,
      tokens: { input: 0, output: 0, total: 0, source: "runtime" },
    };
    await writeRunArtifact(
      ctx,
      run_id,
      "phases/report.json",
      JSON.stringify(reportTrace, null, 2) + "\n",
    );

    return {
      run_id,
      status,
      markdown,
      reportPath: reportFile.hostPath,
      summaryPath: summaryFile.hostPath,
      tokens: { input: tokIn, output: tokOut, total: tokIn + tokOut },
      cost: summary.cost,
    };
  },
});
