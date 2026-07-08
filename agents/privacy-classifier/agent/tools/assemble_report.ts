import { defineTool } from "eve/tools";
import { z } from "zod";

import { readHostRunArtifact, writeRunArtifact } from "shared/lib/run.js";
import { buildRunSummary } from "shared/lib/summary.js";

import {
  ComplianceImpactSchema,
  DocumentClassificationSchema,
  NormalizedFindingSchema,
  ProcessingStatusSchema,
  StructuralClassSchema,
} from "#lib/schemas.js";

// ── Deterministic final assembly (no LLM) ──────────────────────────────────
//
// See openspec/changes/add-privacy-classifier/design.md. Merges run-meta.json
// + findings.normalized.json + compliance_impact.json into the single generic
// result the whole pipeline exists to produce, validates it against the
// schema before writing, and emits the mandatory summary.json (tokens/cost/
// budget) via the shared kit.

const inputSchema = z.object({
  run_dir: z
    .string()
    .min(1)
    .describe("The run directory, e.g. runs/2026-07-05T14-26-27Z"),
  run_id: z.string().min(1),
  document: z.object({
    source_path: z.string(),
    file_name: z.string(),
    file_type: z.string(),
    size_bytes: z.number(),
    page_count: z.number().optional(),
    structural_class: StructuralClassSchema,
    processing_status: ProcessingStatusSchema,
    ocr_enabled: z.boolean().default(false),
    extraction_method: z.string().default("n/a"),
    chunk_count: z.number().default(0),
    reason: z
      .string()
      .optional()
      .describe("Required when processing_status is not 'processed'."),
  }),
});

interface RunMeta {
  started_at?: string;
  pii_engine?: string;
  models?: Record<string, string>;
}

export default defineTool({
  description:
    "Deterministically assemble the final result.json (validated against the " +
    "generic DocumentClassification schema) and summary.json from run-meta.json, " +
    "findings.normalized.json, and compliance_impact.json. No LLM. Call once, " +
    "near the end of a run, whether the document was processed or rejected as " +
    "out of scope.",
  inputSchema,
  async execute({ run_dir, run_id, document }, ctx) {
    const runId = run_dir.replace(/^runs\//, "").replace(/\/+$/, "");
    if (!runId || runId.includes("..") || runId.includes("/") || runId !== run_id) {
      throw new Error(`Invalid run_dir/run_id: ${run_dir} / ${run_id}`);
    }

    const metaRaw = await readHostRunArtifact(runId, "run-meta.json");
    const meta = JSON.parse(metaRaw) as RunMeta;

    const processed = document.processing_status === "processed";

    const findings = processed
      ? (
          JSON.parse(
            await readHostRunArtifact(runId, "findings.normalized.json"),
          ) as { findings: unknown[] }
        ).findings.map((f) => NormalizedFindingSchema.parse(f))
      : [];

    const complianceImpact = processed
      ? ComplianceImpactSchema.parse(
          JSON.parse(await readHostRunArtifact(runId, "compliance_impact.json")),
        )
      : { impacted_jurisdictions: [], hits: [], regime_matrix_version: "n/a" };

    const endedAt = new Date().toISOString();
    const result = DocumentClassificationSchema.parse({
      document,
      engine: meta.pii_engine ?? "unknown",
      findings,
      compliance_impact: complianceImpact,
      run: {
        run_id: runId,
        started_at: meta.started_at ?? endedAt,
        ended_at: endedAt,
        models: meta.models ?? {},
      },
    });

    const resultFile = await writeRunArtifact(
      ctx,
      runId,
      "result.json",
      JSON.stringify(result, null, 2) + "\n",
    );

    const stepBudget = Number.parseInt(process.env.RUN_STEP_BUDGET ?? "", 10);
    const wallBudget = Number.parseInt(
      process.env.RUN_WALL_CLOCK_BUDGET_S ?? "",
      10,
    );
    const summary = buildRunSummary({
      runId,
      models: meta.models,
      fallbackModelId: meta.models?.orchestrator,
      budget: {
        steps: Number.isFinite(stepBudget) ? stepBudget : undefined,
        wallClockSeconds: Number.isFinite(wallBudget) ? wallBudget : undefined,
      },
    });
    const summaryFile = await writeRunArtifact(
      ctx,
      runId,
      "summary.json",
      JSON.stringify(summary, null, 2) + "\n",
    );

    return {
      run_id: runId,
      result_path: resultFile.hostPath,
      summary_path: summaryFile.hostPath,
      processing_status: document.processing_status,
      impacted_jurisdictions: complianceImpact.impacted_jurisdictions,
      tokens: summary.totals,
      cost: summary.cost,
    };
  },
});
