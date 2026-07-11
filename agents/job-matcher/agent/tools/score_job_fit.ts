import { defineTool } from "eve/tools";
import { z } from "zod";

import { sandboxRunDir, writeRunArtifact } from "shared/lib/run.js";

import { matchBandFor, scoreJobFit } from "#lib/scoring.ts";
import { JobAnalysisSchema } from "#lib/schemas.ts";

// ── Thin wrapper over the pure formula (agent/lib/scoring.ts) ─────────────
//
// See openspec/changes/add-job-matcher/design.md. The formula itself is
// pinned by evals/scoring_determinism.eval.ts and evals/match_banding.eval.ts
// (Bolt 1), which import agent/lib/scoring.ts directly — this tool exists
// only so the orchestrator can call the same logic without duplicating it.
// No LLM. This is the ONLY place a numeric score is produced.
//
// Correction 4 (design.md): pass-by-reference. The direct (N=1) path
// passes analysis_path (written by analyze_job_fit) so the orchestrator
// never retypes the JobAnalysis into this call. The subagent (N>1) path
// passes the returned JobAnalysis inline once — this tool persists it to
// analysis/<job_index>.json so assemble_report can also read it by path.

function bytesOf(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string") return Buffer.from(value, "utf-8");
  if (value && typeof value === "object" && "content" in value) {
    return bytesOf((value as { content: unknown }).content);
  }
  return Buffer.from(value as ArrayBufferLike);
}

export default defineTool({
  description:
    "Deterministically compute the 100-point score breakdown and match " +
    "band from a JobAnalysis's skill counts and alignment levels. Pure " +
    "function — no LLM; this tool is the only source of a score. Pass " +
    "analysis_path (from analyze_job_fit) when the analysis is already on " +
    "disk, or the inline analysis returned by a job-analyst subagent — " +
    "never both. Inline analyses are persisted to analysis/<job_index>.json " +
    "so assemble_report can read them by path.",
  inputSchema: z
    .object({
      run_dir: z
        .string()
        .min(1)
        .describe("The run directory, e.g. runs/2026-07-05T14-26-27Z"),
      job_index: z
        .number()
        .int()
        .min(0)
        .describe("The job's index from fetch_job_postings."),
      analysis_path: z
        .string()
        .optional()
        .describe("Run-relative path to an analysis JSON written by analyze_job_fit."),
      analysis: JobAnalysisSchema.optional().describe(
        "Inline JobAnalysis returned by a job-analyst subagent (N>1 path only).",
      ),
    })
    .refine((v) => (v.analysis_path === undefined) !== (v.analysis === undefined), {
      message: "Provide exactly one of analysis_path or analysis.",
    }),
  async execute({ run_dir, job_index, analysis_path, analysis }, ctx) {
    const runId = run_dir.replace(/^runs\//, "").replace(/\/+$/, "");
    if (!runId || runId.includes("..") || runId.includes("/")) {
      throw new Error(`Invalid run_dir: ${run_dir}`);
    }

    let resolvedPath: string;
    let resolved: z.infer<typeof JobAnalysisSchema>;
    if (analysis !== undefined) {
      resolvedPath = `analysis/${job_index}.json`;
      resolved = analysis;
      await writeRunArtifact(ctx, runId, resolvedPath, JSON.stringify(analysis, null, 2) + "\n");
    } else {
      if (analysis_path!.startsWith("/") || analysis_path!.split("/").includes("..")) {
        throw new Error(`analysis_path must be run-relative with no '..': ${analysis_path}`);
      }
      resolvedPath = analysis_path!;
      const sandbox = await ctx.getSandbox();
      const raw = bytesOf(
        await sandbox.readBinaryFile({ path: `${sandboxRunDir(runId)}/${resolvedPath}` }),
      ).toString("utf-8");
      resolved = JobAnalysisSchema.parse(JSON.parse(raw));
    }

    const breakdown = scoreJobFit({
      requiredSkills: resolved.required_skills,
      preferredSkills: resolved.preferred_skills,
      experienceAlignment: resolved.experience_alignment,
      domainAlignment: resolved.domain_alignment,
    });
    return {
      analysis_path: resolvedPath,
      score_breakdown: breakdown,
      match_status: matchBandFor(breakdown.total_score),
    };
  },
});
