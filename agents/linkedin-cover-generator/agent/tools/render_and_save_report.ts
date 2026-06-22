import { defineTool } from "eve/tools";
import { z } from "zod";

import { modelIdFor } from "shared/lib/model.js";
import { writeRunArtifact } from "shared/lib/run.js";
import { buildRunSummary } from "shared/lib/summary.js";

// ── Deterministic report assembly (no LLM) ─────────────────────────────────
//
// See openspec/adr/0001-shared-agent-runtime-kit.md §2 and §5. Replaces the
// former `reporter` LLM subagent: report assembly is arithmetic + templating,
// so it lives in a code tool. Reads the persisted phase traces + run-meta.json
// + cover-spec.json from the sandbox run folder, computes timing from the
// traces and token/cost totals from the shared usage hook + cost matrix, and
// writes report.md + summary.json (mirrored to host + sandbox).

interface PhaseTrace {
  phase?: string;
  model?: string;
  started_at?: string;
  ended_at?: string;
  duration_s?: number;
  tokens?: { input?: number; output?: number; total?: number; source?: string };
}

const inputSchema = z.object({
  run_dir: z
    .string()
    .describe("The run directory, e.g. runs/2026-06-21T17-09-53Z"),
  run_id: z.string().min(1).describe("The run id (the timestamp folder name)"),
  validation: z
    .object({
      passed: z.boolean(),
      width: z.number().int(),
      height: z.number().int(),
      expected_width: z.number().int(),
      expected_height: z.number().int(),
      issues: z.array(z.string()).default([]),
    })
    .describe("The result returned by validate_image"),
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

function fmtDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "n/a";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem === 0 ? `${m}m` : `${m}m ${rem}s`;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export default defineTool({
  description:
    "Deterministically assemble report.md and summary.json from the persisted " +
    "phase traces, run-meta.json, and cover-spec.json. Computes timing from the " +
    "traces and token/cost totals from the shared usage hook + cost matrix. No " +
    "LLM. Call after write_orchestrate_trace; pass the validate_image result.",
  inputSchema,

  async execute({ run_dir, run_id, validation, allow_cost }, ctx) {
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
    const spec = (await readJson<Record<string, unknown>>("cover-spec.json")) ?? {};
    const orchestrate = await readJson<PhaseTrace>("phases/orchestrate.json");
    const generate = await readJson<PhaseTrace>("phases/generate.json");
    const validate = await readJson<PhaseTrace>("phases/validate.json");

    const models = (meta.models as Record<string, string> | undefined) ?? {};
    const orchestratorModel = models.orchestrator ?? modelIdFor("orchestrator");
    const imageModel = models.image ?? process.env.IMAGE_MODEL ?? "gpt-image-2";
    const request = typeof meta.request === "string" ? meta.request : "";

    // ── Timing ──────────────────────────────────────────────────────────────
    const phaseTraces: Array<{ key: string; trace?: PhaseTrace }> = [
      { key: "orchestrate", trace: orchestrate },
      { key: "generate", trace: generate },
      { key: "validate", trace: validate },
    ];
    const endedAtTool = new Date().toISOString();
    const reportDuration = Math.max(
      0,
      Math.round((Date.parse(endedAtTool) - Date.parse(startedAtTool)) / 1000),
    );

    const perPhase: Record<string, number> = {
      orchestrate: num(orchestrate?.duration_s),
      generate: num(generate?.duration_s),
      validate: num(validate?.duration_s),
      report: reportDuration,
    };
    const computeSeconds =
      perPhase.orchestrate + perPhase.generate + perPhase.validate + perPhase.report;

    const allStamps = [
      orchestrate?.started_at,
      orchestrate?.ended_at,
      generate?.started_at,
      generate?.ended_at,
      validate?.started_at,
      validate?.ended_at,
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
    const tokenPhases: Array<{ label: string; trace?: PhaseTrace }> = [
      { label: "orchestrate", trace: orchestrate },
      { label: "generate", trace: generate },
      { label: "validate", trace: validate },
    ];
    let tokIn = 0;
    let tokOut = 0;
    let anyRuntime = false;
    const tokenRows = tokenPhases.map(({ label, trace }) => {
      const input = num(trace?.tokens?.input);
      const output = num(trace?.tokens?.output);
      const total = num(trace?.tokens?.total) || input + output;
      const source = trace?.tokens?.source ?? "unavailable";
      if (source === "runtime") {
        tokIn += input;
        tokOut += output;
        anyRuntime = true;
      }
      return `| ${label} | ${input} | ${output} | ${total} | ${source} |`;
    });
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
      models: { orchestrator: orchestratorModel, image: imageModel },
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

    // ── Validation + spec ───────────────────────────────────────────────────
    const status = validation.passed ? "ok" : "partial";
    const canvas =
      validation.expected_width && validation.expected_height
        ? `${validation.expected_width}×${validation.expected_height}`
        : typeof (spec.canvas as { width?: number })?.width === "number"
          ? `${(spec.canvas as { width: number }).width}×${(spec.canvas as { height: number }).height}`
          : "n/a";
    const title = typeof spec.title === "string" ? spec.title : "n/a";
    const palette = typeof spec.palette === "string" ? spec.palette : "n/a";
    const validationResult = validation.passed
      ? `passed (${validation.width}×${validation.height})`
      : `failed (${validation.width}×${validation.height}; expected ${validation.expected_width}×${validation.expected_height})`;
    const validationIssues =
      validation.issues.length > 0
        ? validation.issues.map((issue) => `- ${issue}`).join("\n")
        : "";

    const artifacts = ["cover.png", "cover-spec.json", "report.md", "summary.json"];
    const artifactLinks = artifacts.map((name) => `- \`${name}\``).join("\n");

    // ── Render report.md ────────────────────────────────────────────────────
    const lines: string[] = [
      `# LinkedIn Cover Run — ${run_id}`,
      "",
      `**Status:** ${status}  ·  **Generated:** ${endedAtTool}`,
      "",
      `> Request: ${request || "n/a"}`,
      "",
      "## Models",
      "| Phase | Model |",
      "|---|---|",
      `| Orchestrator | ${orchestratorModel} |`,
      `| Image | ${imageModel} |`,
      "",
      "## Execution time",
      "| Phase | Duration |",
      "|---|---|",
      `| Orchestrate (spec + prompt) | ${fmtDuration(perPhase.orchestrate)} |`,
      `| Image generation | ${fmtDuration(perPhase.generate)} |`,
      `| Validation | ${fmtDuration(perPhase.validate)} |`,
      `| Report | ${fmtDuration(perPhase.report)} |`,
      `| **Wall-clock total** | **${fmtDuration(wallSeconds)}** |`,
      "",
      `_Compute-seconds (sum of phases): ${computeSeconds}_`,
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
      "## Validation",
      `- Canvas: ${canvas}`,
      `- Title: ${title}`,
      `- Palette: ${palette}`,
      `- Result: ${validationResult}`,
      ...(validationIssues ? [validationIssues] : []),
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
      model: "deterministic",
      started_at: startedAtTool,
      ended_at: endedAtTool,
      duration_s: reportDuration,
      tokens: { input: 0, output: 0, total: 0, source: "runtime" },
    };
    await sandbox.writeTextFile({
      path: `${run_dir}/phases/report.json`,
      content: JSON.stringify(reportTrace, null, 2) + "\n",
    });

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
