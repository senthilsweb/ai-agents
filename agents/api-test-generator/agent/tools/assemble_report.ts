import { defineTool } from "eve/tools";
import { z } from "zod";

import { modelIdFor } from "shared/lib/model.js";
import { writeRunArtifact } from "shared/lib/run.js";
import { buildRunSummary } from "shared/lib/summary.js";

// ── Interfaces ───────────────────────────────────────────────────────────────

interface PhaseTrace {
  phase?: string;
  model?: string | null;
  started_at?: string;
  ended_at?: string;
  duration_s?: number;
  tokens?: { input?: number | null; output?: number | null; total?: number | null; source?: string };
  usage?: { input?: number | null; output?: number | null; total?: number | null; source?: string };
}

interface NewmanExecution {
  item?: { name?: string };
  cursor?: { iteration?: number; position?: number };
  response?: { code?: number; responseTime?: number };
  assertions?: Array<{ assertion?: string; skipped?: boolean; error?: { message?: string } | null }>;
}

interface DataRow {
  TSName?: string;
  product?: string;
  feature?: string;
  capability?: string;
  domain?: string;
  _validation_type?: string;
  [key: string]: unknown;
}

interface ApiConfig {
  api_name?: string;
  data_file?: string;
  endpoints?: Array<{ operationId?: string; request_name?: string; feature?: string; capability?: string }>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function fmtDuration(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "n/a";
  const sec = Math.round(s);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return r === 0 ? `${m}m` : `${m}m ${r}s`;
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "content" in value) {
    const c = (value as { content: unknown }).content;
    if (typeof c === "string") return c;
  }
  return String(value ?? "");
}

function tokensOf(trace?: PhaseTrace) {
  const t = trace?.tokens ?? trace?.usage;
  const input = num(t?.input);
  const output = num(t?.output);
  const total = num(t?.total) || input + output;
  const source = t?.source ?? "unavailable";
  return { input, output, total, source };
}

/** Parse year/month/day from an ISO timestamp or run_id like "2026-06-28T10-00-00Z". */
function parseDateParts(ts: string): { year: string; month: string; day: string } {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(ts);
  return m
    ? { year: m[1], month: m[2], day: m[3] }
    : { year: "unknown", month: "unknown", day: "unknown" };
}

// ── Tool ─────────────────────────────────────────────────────────────────────

export default defineTool({
  description:
    "Deterministically assemble coverage_report.md, gaps_report.md, report.md, " +
    "summary.json, AND structured/ analytics artifacts (test_results.jsonl, " +
    "coverage.json, matrix.jsonl) from phase traces, Newman results, and run data. " +
    "No LLM — pure arithmetic and templating.",
  inputSchema: z.object({
    run_dir: z.string(),
    run_id: z.string().min(1),
    allow_cost: z.boolean().optional(),
  }),
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

    // ── Phase traces & metadata ──────────────────────────────────────────────
    const meta = (await readJson<Record<string, unknown>>("run-meta.json")) ?? {};
    const orchestrate = await readJson<PhaseTrace>("phases/orchestrate.json");
    const pairwiseDesigner = await readJson<PhaseTrace>("phases/pairwise-designer.json");
    const assertionWriter = await readJson<PhaseTrace>("phases/assertion-writer.json");

    const models = (meta.models as Record<string, string> | undefined) ?? {};
    const orchestratorModel = models.orchestrator ?? modelIdFor("orchestrator");
    const pairwiseModel = models.pairwise_designer ?? modelIdFor("pairwise_designer");
    const assertionModel = models.assertion_writer ?? modelIdFor("assertion_writer");

    const options = (meta.options as Record<string, unknown> | undefined) ?? {};
    const apiName = String(options.api_name ?? meta.request ?? "API");
    const specFile = String(options.spec ?? "unknown");
    const startedAt = String(meta.started_at ?? startedAtTool);
    const { year, month, day } = parseDateParts(startedAt);

    // ── api_config.json (classification registry per endpoint) ───────────────
    const apiConfig = (await readJson<ApiConfig>("api_config.json")) ?? {};
    const endpointIndex = new Map<string, { feature: string; capability: string }>();
    for (const ep of apiConfig.endpoints ?? []) {
      if (ep.request_name) {
        endpointIndex.set(ep.request_name, {
          feature: ep.feature ?? "unknown",
          capability: ep.capability ?? "unknown",
        });
      }
    }

    // ── Iteration data file (TSName + classification per row) ─────────────────
    const dataFileName = apiConfig.data_file ?? `${apiName}_data.json`;
    const dataRows = (await readJson<DataRow[]>(dataFileName)) ?? [];

    // ── Newman results ────────────────────────────────────────────────────────
    const newmanJson = await readJson<{
      run?: {
        stats?: {
          assertions?: { total?: number; failed?: number };
          iterations?: { total?: number; failed?: number };
          requests?: { total?: number; failed?: number };
        };
        timings?: { duration?: number; started?: number };
        executions?: NewmanExecution[];
      };
    }>("newman_report.json");

    const newmanStats = newmanJson?.run?.stats?.assertions;
    const newmanTotal = num(newmanStats?.total);
    const newmanFailed = num(newmanStats?.failed);
    const newmanPassed = newmanTotal - newmanFailed;
    const newmanPassRate = newmanTotal > 0 ? Math.round((newmanPassed / newmanTotal) * 100) : 0;
    const newmanDuration = num(newmanJson?.run?.timings?.duration);
    const executions = newmanJson?.run?.executions ?? [];

    const iterStats = newmanJson?.run?.stats?.iterations;
    const iterTotal = num(iterStats?.total);
    const iterFailed = num(iterStats?.failed);
    const iterPassed = iterTotal - iterFailed;

    // ── Matrix stats ──────────────────────────────────────────────────────────
    const matrix = await readJson<{
      total_rows?: number;
      pair_coverage_pct?: number;
      endpoints?: Record<string, { strength?: number; factors?: number; rows?: Record<string, string>[] }>;
    }>("pairwise_matrix.json");
    const totalRows = num(matrix?.total_rows);
    const pairCoverage = num(matrix?.pair_coverage_pct ?? 100);

    // ── Endpoint coverage ─────────────────────────────────────────────────────
    const namedModel = await readJson<{
      endpoints?: { operationId?: string; requestName?: string }[];
    }>("named_endpoint_model.json");
    const endpointTotal = namedModel?.endpoints?.length ?? 0;
    const coveredEndpoints = Object.keys(matrix?.endpoints ?? {}).length;
    const endpointCoverage = endpointTotal > 0
      ? Math.round((coveredEndpoints / endpointTotal) * 100)
      : 0;

    // ── Validation ────────────────────────────────────────────────────────────
    const validationMd = textOf(
      await sandbox.readTextFile({ path: `/workspace/${run_dir}/validation_report.md` })
        .catch(() => ""),
    );
    const validationPassed = validationMd.includes("✅ PASSED");
    const validationErrors = (validationMd.match(/\| ERROR \|/g) ?? []).length;
    const validationWarnings = (validationMd.match(/\| WARN \|/g) ?? []).length;

    // ── Timing ───────────────────────────────────────────────────────────────
    const endedAtTool = new Date().toISOString();
    const reportDuration = Math.max(0, Math.round((Date.parse(endedAtTool) - Date.parse(startedAtTool)) / 1000));

    const perPhase: Record<string, number> = {
      orchestrate: num(orchestrate?.duration_s),
      pairwise_designer: num(pairwiseDesigner?.duration_s),
      assertion_writer: num(assertionWriter?.duration_s),
      report: reportDuration,
    };
    const computeSeconds = Object.values(perPhase).reduce((a, b) => a + b, 0);

    // ── Tokens ───────────────────────────────────────────────────────────────
    let tokIn = 0;
    let tokOut = 0;
    let anyRuntime = false;
    const tokenRows: string[] = [];

    const pushRow = (label: string, trace?: PhaseTrace) => {
      const t = tokensOf(trace);
      if (t.source === "runtime") {
        tokIn += t.input;
        tokOut += t.output;
        anyRuntime = true;
      }
      tokenRows.push(`| ${label} | ${t.input} | ${t.output} | ${t.total} | ${t.source} |`);
    };
    pushRow("Orchestrate", orchestrate);
    pushRow("Pairwise Designer", pairwiseDesigner);
    pushRow("Assertion Writer", assertionWriter);

    // ── Cost ─────────────────────────────────────────────────────────────────
    const summary = buildRunSummary({
      runId: run_id,
      models: {
        orchestrator: orchestratorModel,
        pairwise_designer: pairwiseModel,
        assertion_writer: assertionModel,
      },
      fallbackModelId: orchestratorModel,
      budget: {
        steps: Number.isFinite(parseInt(process.env.RUN_STEP_BUDGET ?? ""))
          ? parseInt(process.env.RUN_STEP_BUDGET ?? "")
          : undefined,
        wallClockSeconds: Number.isFinite(parseInt(process.env.RUN_WALL_CLOCK_BUDGET_S ?? ""))
          ? parseInt(process.env.RUN_WALL_CLOCK_BUDGET_S ?? "")
          : undefined,
      },
    });

    const costRated = allowCost && summary.cost.rated;
    const currency = summary.cost.currency ?? "USD";
    const costRows = costRated
      ? summary.cost.byModel.map((m) => `| ${m.modelId} | ${currency} ${m.amount.toFixed(6)} |`)
      : ["| — | n/a |"];
    const costTotal = costRated ? `${currency} ${summary.cost.amount.toFixed(6)}` : "n/a";
    const costUsd = costRated ? summary.cost.amount : null;

    const status = validationPassed && newmanPassRate >= 80 ? "ok" : "partial";

    // ═══════════════════════════════════════════════════════════════════════════
    // STRUCTURED ANALYTICS OUTPUT — DuckDB-queryable
    // ═══════════════════════════════════════════════════════════════════════════

    // ── structured/test_results.jsonl ─────────────────────────────────────────
    // One JSON line per Newman execution (request × data iteration).
    // When Newman didn't run, synthesize rows from the matrix with status="not_run".

    const resultLines: string[] = [];
    const product = String(options.product ?? apiName.toUpperCase().slice(0, 8));
    const domain = options.domain ? String(options.domain) : null;

    if (executions.length > 0) {
      // Build operationId lookup by request name (from namedModel)
      const opIdByRequest = new Map<string, string>();
      for (const ep of namedModel?.endpoints ?? []) {
        if (ep.requestName && ep.operationId) opIdByRequest.set(ep.requestName, ep.operationId);
      }

      for (const exec of executions) {
        const reqName = String(exec.item?.name ?? "");
        const iterIdx = num(exec.cursor?.iteration ?? 0);
        const dataRow: DataRow = dataRows[iterIdx] ?? {};
        const epInfo = endpointIndex.get(reqName) ?? { feature: "unknown", capability: "unknown" };

        const assertionsPassed = (exec.assertions ?? []).filter((a) => !a.error && !a.skipped).length;
        const assertionsFailed = (exec.assertions ?? []).filter((a) => !!a.error).length;
        const assertionErrors = (exec.assertions ?? [])
          .filter((a) => a.error?.message)
          .map((a) => a.error!.message!);

        const row = {
          run_id,
          api_name: apiName,
          product: String(dataRow.product ?? product),
          feature: String(dataRow.feature ?? epInfo.feature),
          capability: String(dataRow.capability ?? epInfo.capability),
          domain: dataRow.domain ?? domain,
          ts_name: String(dataRow.TSName ?? ""),
          validation_type: String(dataRow._validation_type ?? ""),
          request_name: reqName,
          operation_id: opIdByRequest.get(reqName) ?? "",
          iteration_index: iterIdx,
          status: assertionsFailed > 0 ? "failed" : "passed",
          http_status_code: num(exec.response?.code),
          response_time_ms: num(exec.response?.responseTime),
          assertions_total: (exec.assertions ?? []).length,
          assertions_passed: assertionsPassed,
          assertions_failed: assertionsFailed,
          assertion_errors: assertionErrors,
          year,
          month,
          day,
          started_at: startedAt,
        };
        resultLines.push(JSON.stringify(row));
      }
    } else {
      // Newman not run — synthesize "not_run" rows from pairwise matrix
      for (const [opId, epMatrix] of Object.entries(matrix?.endpoints ?? {})) {
        const namedEp = namedModel?.endpoints?.find((e) => e.operationId === opId);
        const reqName = namedEp?.requestName ?? opId;
        const epInfo = endpointIndex.get(reqName) ?? { feature: "unknown", capability: "unknown" };

        (epMatrix.rows ?? []).forEach((mRow, idx) => {
          const dataRow: DataRow = dataRows[idx] ?? {};
          const row = {
            run_id,
            api_name: apiName,
            product: String(dataRow.product ?? product),
            feature: String(dataRow.feature ?? epInfo.feature),
            capability: String(dataRow.capability ?? epInfo.capability),
            domain: dataRow.domain ?? domain,
            ts_name: String(dataRow.TSName ?? ""),
            validation_type: String(dataRow._validation_type ?? ""),
            request_name: reqName,
            operation_id: opId,
            iteration_index: idx,
            status: "not_run",
            http_status_code: null,
            response_time_ms: null,
            assertions_total: null,
            assertions_passed: null,
            assertions_failed: null,
            assertion_errors: [],
            year,
            month,
            day,
            started_at: startedAt,
          };
          resultLines.push(JSON.stringify(row));
        });
      }
    }

    // ── structured/coverage.json ──────────────────────────────────────────────
    const coverageObj = {
      run_id,
      api_name: apiName,
      product,
      domain,
      spec_file: specFile,
      endpoint_count: endpointTotal,
      endpoints_with_tests: coveredEndpoints,
      endpoint_coverage_pct: endpointCoverage,
      total_matrix_rows: totalRows,
      pair_coverage_pct: pairCoverage,
      newman_iterations_total: iterTotal,
      newman_iterations_passed: iterPassed,
      newman_iterations_failed: iterFailed,
      newman_assertions_total: newmanTotal,
      newman_assertions_passed: newmanPassed,
      newman_assertions_failed: newmanFailed,
      newman_pass_rate_pct: newmanPassRate,
      validation_passed: validationPassed,
      validation_errors: validationErrors,
      validation_warnings: validationWarnings,
      tokens_input: tokIn,
      tokens_output: tokOut,
      tokens_total: tokIn + tokOut,
      estimated_cost_usd: costUsd,
      duration_ms: computeSeconds * 1000,
      year,
      month,
      day,
      started_at: startedAt,
      completed_at: endedAtTool,
    };

    // ── structured/matrix.jsonl ───────────────────────────────────────────────
    // One JSON line per pairwise matrix row, with factor values spread inline.
    const matrixLines: string[] = [];
    for (const [opId, epMatrix] of Object.entries(matrix?.endpoints ?? {})) {
      const namedEp = namedModel?.endpoints?.find((e) => e.operationId === opId);
      const reqName = namedEp?.requestName ?? opId;
      const epInfo = endpointIndex.get(reqName) ?? { feature: "unknown", capability: "unknown" };

      (epMatrix.rows ?? []).forEach((mRow, idx) => {
        const dataRow: DataRow = dataRows[idx] ?? {};
        const matRow: Record<string, unknown> = {
          run_id,
          api_name: apiName,
          operation_id: opId,
          request_name: reqName,
          row_index: idx,
          product: String(dataRow.product ?? product),
          feature: String(dataRow.feature ?? epInfo.feature),
          capability: String(dataRow.capability ?? epInfo.capability),
          domain: dataRow.domain ?? domain,
          strength: epMatrix.strength ?? 2,
          factor_count: epMatrix.factors ?? 0,
          year,
          month,
          day,
          // Spread all factor values from the matrix row
          ...mRow,
        };
        matrixLines.push(JSON.stringify(matRow));
      });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MARKDOWN REPORTS
    // ═══════════════════════════════════════════════════════════════════════════

    const coverageLines = [
      `# API Test Coverage Report — ${run_id}`,
      "",
      `**Generated:** ${endedAtTool}  ·  **API:** ${apiName}  ·  **Spec:** ${specFile}`,
      "",
      "## Summary",
      "| Metric | Value |",
      "|---|---|",
      `| Endpoints in spec | ${endpointTotal} |`,
      `| Endpoints with test rows | ${coveredEndpoints} |`,
      `| Endpoint coverage | ${endpointCoverage}% |`,
      `| Total test rows (pairwise matrix) | ${totalRows} |`,
      `| Pair coverage | ${pairCoverage}% |`,
      `| Newman assertions passed | ${newmanPassed} |`,
      `| Newman assertions failed | ${newmanFailed} |`,
      `| Newman pass rate | ${newmanPassRate}% |`,
      `| Newman execution time | ${fmtDuration(Math.round(newmanDuration / 1000))} |`,
      `| Validation | ${validationPassed ? "✅ passed" : "❌ failed"} |`,
      "",
      "## Models",
      "| Role | Model |",
      "|---|---|",
      `| Orchestrator | ${orchestratorModel} |`,
      `| Pairwise Designer | ${pairwiseModel} |`,
      `| Assertion Writer | ${assertionModel} |`,
      "",
      "## Token consumption",
      "| Phase | Input | Output | Total | Source |",
      "|---|---:|---:|---:|---|",
      ...tokenRows,
      `| **Total** | **${tokIn}** | **${tokOut}** | **${tokIn + tokOut}** | ${anyRuntime ? "runtime" : "unavailable"} |`,
      "",
      "## Token cost",
      "| Model | Cost |",
      "|---|---:|",
      ...costRows,
      `| **Total** | **${costTotal}** |`,
      "",
      "_Rates are estimates from the shared cost rate-card._",
      "",
      "## Artifacts",
      "- `*_collection.json` — Postman collection with embedded test scripts",
      "- `*_environment.json` — Postman environment",
      "- `*_data.json` — Newman iteration data (extend freely without touching collection)",
      "- `api_config.json` — Runtime config (base URL, auth profile, endpoint index)",
      "- `collection_data.yml` — Manifest registry",
      "- `test_scripts/*.js` — Extracted assertion scripts for code review",
      "- `pict_models/*.pict` — PICT model files (recommend version-controlling alongside spec)",
      "- `pairwise_matrix.csv` — Human-readable pairwise matrix",
      "- `newman_report.html` — Newman HTML report",
      "",
      "## Structured analytics (DuckDB-queryable)",
      "- `structured/test_results.jsonl` — per-execution results",
      "- `structured/coverage.json` — run-level metrics",
      "- `structured/matrix.jsonl` — pairwise matrix rows",
      "",
      "**DuckDB example:**",
      "```sql",
      "SELECT feature, capability, status, COUNT(*) AS n",
      "FROM read_json_auto('structured/test_results.jsonl')",
      "GROUP BY 1, 2, 3 ORDER BY n DESC;",
      "```",
      "",
    ];

    const uncoveredEndpoints = (namedModel?.endpoints ?? []).filter(
      (ep) => !Object.keys(matrix?.endpoints ?? {}).includes(String(ep.operationId ?? "")),
    );

    const gapsLines = [
      `# API Test Gaps Report — ${run_id}`,
      "",
      "## Uncovered endpoints",
      "",
      uncoveredEndpoints.length === 0
        ? "_All endpoints have test rows._"
        : [
            "| Endpoint | Reason |",
            "|---|---|",
            ...uncoveredEndpoints.map(
              (ep) => `| ${ep.requestName ?? ep.operationId} | No factors defined in factors_model |`,
            ),
          ].join("\n"),
      "",
      "## Validation findings",
      "",
      validationMd || "_No validation report found._",
      "",
      "## Recommended actions",
      "",
      ...(uncoveredEndpoints.length > 0
        ? uncoveredEndpoints.map(
            (ep) => `- [ ] Add factors for \`${ep.operationId}\` to the Pairwise Designer output.`,
          )
        : ["_No gaps found._"]),
      "",
    ];

    const reportLines = [
      `# API Test Generator Run Report — ${run_id}`,
      "",
      `**Status:** ${status}  ·  **API:** ${apiName}  ·  **Generated:** ${endedAtTool}`,
      "",
      "## Execution time",
      "| Phase | Duration |",
      "|---|---|",
      `| Orchestrate | ${fmtDuration(perPhase.orchestrate)} |`,
      `| Pairwise Designer | ${fmtDuration(perPhase.pairwise_designer)} |`,
      `| Assertion Writer | ${fmtDuration(perPhase.assertion_writer)} |`,
      `| Report | ${fmtDuration(reportDuration)} |`,
      `| **Compute total** | **${fmtDuration(computeSeconds)}** |`,
      "",
      "## Token consumption",
      "| Phase | Input | Output | Total | Source |",
      "|---|---:|---:|---:|---|",
      ...tokenRows,
      `| **Total** | **${tokIn}** | **${tokOut}** | **${tokIn + tokOut}** | ${anyRuntime ? "runtime" : "unavailable"} |`,
      "",
      "## Cost",
      "| Model | Cost |",
      "|---|---:|",
      ...costRows,
      `| **Total** | **${costTotal}** |`,
      "",
      "---",
      "<sub>Generated deterministically — no LLM.</sub>",
      "",
    ];

    // ── Phase trace ───────────────────────────────────────────────────────────
    const reportTrace: PhaseTrace = {
      phase: "report",
      model: "deterministic",
      started_at: startedAtTool,
      ended_at: endedAtTool,
      duration_s: reportDuration,
      tokens: { input: 0, output: 0, total: 0, source: "runtime" },
    };

    // ── Write all artifacts ───────────────────────────────────────────────────
    await Promise.all([
      writeRunArtifact(ctx, run_id, "coverage_report.md", coverageLines.join("\n").trim() + "\n"),
      writeRunArtifact(ctx, run_id, "gaps_report.md", gapsLines.join("\n").trim() + "\n"),
      writeRunArtifact(ctx, run_id, "report.md", reportLines.join("\n").trim() + "\n"),
      writeRunArtifact(ctx, run_id, "summary.json", JSON.stringify(summary, null, 2) + "\n"),
      writeRunArtifact(ctx, run_id, "phases/report.json", JSON.stringify(reportTrace, null, 2) + "\n"),
      // Structured analytics
      writeRunArtifact(ctx, run_id, "structured/test_results.jsonl", resultLines.join("\n") + "\n"),
      writeRunArtifact(ctx, run_id, "structured/coverage.json", JSON.stringify(coverageObj, null, 2) + "\n"),
      writeRunArtifact(ctx, run_id, "structured/matrix.jsonl", matrixLines.join("\n") + "\n"),
    ]);

    return {
      coverage_report_path: `${run_dir}/coverage_report.md`,
      gaps_report_path: `${run_dir}/gaps_report.md`,
      report_path: `${run_dir}/report.md`,
      summary_path: `${run_dir}/summary.json`,
      structured_dir: `${run_dir}/structured/`,
      structured_files: [
        `${run_dir}/structured/test_results.jsonl`,
        `${run_dir}/structured/coverage.json`,
        `${run_dir}/structured/matrix.jsonl`,
      ],
      status,
      endpoint_coverage_pct: endpointCoverage,
      pair_coverage_pct: pairCoverage,
      newman_pass_rate: newmanPassRate,
      tokens: { input: tokIn, output: tokOut, total: tokIn + tokOut },
      cost: summary.cost,
      date_parts: { year, month, day },
    };
  },
});
