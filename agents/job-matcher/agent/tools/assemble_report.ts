import { defineTool } from "eve/tools";
import { z } from "zod";

import { sandboxRunDir, writeRunArtifact } from "shared/lib/run.js";
import { buildRunSummary } from "shared/lib/summary.js";

import { formatCoverLetter } from "#lib/templates.ts";
import { recommendationFor } from "#lib/scoring.ts";
import { reportFileName, slugify } from "#lib/slug.ts";
import {
  JobAnalysisSchema,
  JobFetchFailureSchema,
  JobReportSchema,
  MatchStatusSchema,
  ScoreBreakdownSchema,
} from "#lib/schemas.ts";

// ── Deterministic final assembly (no LLM) ──────────────────────────────────
//
// See openspec/changes/add-job-matcher/design.md "Final output — one full
// JSON per job link". V1 stops at content generation: one self-contained
// JSON per job link, plus a ranking.md when there is more than one. No
// DOCX/PDF/HTML — see design.md non-goals.

const TEMPLATE_PATH = "/workspace/inputs/templates/cover_letter.txt";

// Correction 4 (design.md): ok entries carry analysis_path (run-relative,
// written by analyze_job_fit or score_job_fit), never the inline analysis —
// the orchestrator model must not retype the JobAnalysis JSON into this
// call. This tool reads and validates each analysis file itself.
const JobResultInputSchema = z.discriminatedUnion("fetch_status", [
  z.object({
    fetch_status: z.literal("ok"),
    job_source: z.string(),
    analysis_path: z
      .string()
      .min(1)
      .describe("Run-relative path to the analysis JSON, e.g. analysis/0.json."),
    score_breakdown: ScoreBreakdownSchema,
    match_status: MatchStatusSchema,
  }),
  z.object({
    fetch_status: z.literal("failed"),
    job_source: z.string(),
    reason: z.string(),
  }),
]);

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "content" in value) {
    const content = (value as { content: unknown }).content;
    if (typeof content === "string") return content;
  }
  return String(value ?? "");
}

async function loadCoverLetterTemplate(
  ctx: { getSandbox: () => Promise<{ readTextFile(opts: { path: string }): PromiseLike<unknown> }> },
): Promise<string | undefined> {
  try {
    const sandbox = await ctx.getSandbox();
    const raw = await sandbox.readTextFile({ path: TEMPLATE_PATH });
    const text = textOf(raw);
    return text.length > 0 ? text : undefined;
  } catch {
    // Missing template degrades to plain text — see spec.md "Templates
    // staged under inputs": never fail the run for this.
    return undefined;
  }
}

export default defineTool({
  description:
    "Deterministically assemble one self-contained JSON report per job " +
    "link (slug(<job title>)_<timestamp>.json for successes, " +
    "slug(<job source>)_<timestamp>.failed.json for failures), plus " +
    "ranking.md when there is more than one job. No LLM. Call once, near " +
    "the end of a run, after every job has been fetched and (if fetched " +
    "successfully) analyzed and scored.",
  inputSchema: z.object({
    run_dir: z
      .string()
      .min(1)
      .describe("The run directory, e.g. runs/2026-07-05T14-26-27Z"),
    run_id: z.string().min(1),
    resume_file: z.string().min(1),
    models: z.record(z.string(), z.string()),
    results: z.array(JobResultInputSchema).min(1),
  }),
  async execute({ run_dir, run_id, resume_file, models, results }, ctx) {
    const runId = run_dir.replace(/^runs\//, "").replace(/\/+$/, "");
    if (!runId || runId.includes("..") || runId.includes("/") || runId !== run_id) {
      throw new Error(`Invalid run_dir/run_id: ${run_dir} / ${run_id}`);
    }

    const generatedAt = new Date().toISOString();
    const templateText = await loadCoverLetterTemplate(ctx);

    const successFiles: Array<{ file_name: string; job_title: string; total_score: number; match_status: string }> = [];
    const failureFiles: string[] = [];

    for (const result of results) {
      if (result.fetch_status === "ok") {
        if (
          result.analysis_path.startsWith("/") ||
          result.analysis_path.split("/").includes("..")
        ) {
          throw new Error(
            `analysis_path must be run-relative with no '..': ${result.analysis_path}`,
          );
        }
        const sandbox = await ctx.getSandbox();
        const rawAnalysis = textOf(
          await sandbox.readTextFile({
            path: `${sandboxRunDir(runId)}/${result.analysis_path}`,
          }),
        );
        const analysis = JobAnalysisSchema.parse(JSON.parse(rawAnalysis));

        const coverLetter = formatCoverLetter(
          analysis.cover_letter_paragraphs,
          {
            jobTitle: analysis.job_title,
            companyName: analysis.company_name,
            generatedAt,
          },
          templateText,
        );

        const report = JobReportSchema.parse({
          run_id: runId,
          generated_at: generatedAt,
          job_source: result.job_source,
          fetch_status: "ok",
          resume_file,
          models,
          analysis,
          cover_letter_text: coverLetter,
          score_breakdown: result.score_breakdown,
          match_status: result.match_status,
          recommendation: recommendationFor(result.match_status),
        });

        const fileName = reportFileName(analysis.job_title, runId);
        await writeRunArtifact(ctx, runId, fileName, JSON.stringify(report, null, 2) + "\n");
        successFiles.push({
          file_name: fileName,
          job_title: analysis.job_title,
          total_score: result.score_breakdown.total_score,
          match_status: result.match_status,
        });
      } else {
        const failure = JobFetchFailureSchema.parse({
          run_id: runId,
          generated_at: generatedAt,
          job_source: result.job_source,
          fetch_status: "failed",
          reason: result.reason,
          attempted_at: generatedAt,
        });
        const fileName = `${slugify(result.job_source)}_${runId}.failed.json`;
        await writeRunArtifact(ctx, runId, fileName, JSON.stringify(failure, null, 2) + "\n");
        failureFiles.push(fileName);
      }
    }

    // Ranking is a property of a multi-SOURCE run (spec.md: "Multi-job runs
    // SHALL additionally include a ranking"), not of how many happened to
    // fetch successfully — a 3-link run where 2 links failed still gets its
    // one-row ranking plus the failure count, so the run folder reads the
    // same way regardless of failures.
    let rankingPath: string | undefined;
    if (results.length > 1 && successFiles.length > 0) {
      const ranked = [...successFiles].sort((a, b) => b.total_score - a.total_score);
      const lines = [
        "# Job Fit Ranking",
        "",
        `Generated ${generatedAt} · ${ranked.length} jobs analyzed, ${failureFiles.length} failed to fetch.`,
        "",
        "| Rank | Job title | Score | Match | Report |",
        "|---|---|---|---|---|",
        ...ranked.map(
          (r, i) =>
            `| ${i + 1} | ${r.job_title} | ${r.total_score}/100 | ${r.match_status} | \`${r.file_name}\` |`,
        ),
      ];
      const written = await writeRunArtifact(ctx, runId, "ranking.md", lines.join("\n") + "\n");
      rankingPath = written.hostPath;
    }

    // summary.json is mandatory output for every run in this repo (ADR
    // 0001 §5) — token usage per session (orchestrator + each job-analyst
    // delegation) and estimated cost, fed by the shared usage hook
    // (agent/hooks/usage.ts). This is also what answers the Operations
    // question "what does a 3-job fan-out cost vs sequential runs".
    const stepBudget = Number.parseInt(process.env.RUN_STEP_BUDGET ?? "", 10);
    const wallBudget = Number.parseInt(process.env.RUN_WALL_CLOCK_BUDGET_S ?? "", 10);
    const summary = buildRunSummary({
      runId,
      models,
      fallbackModelId: models.job_analyst ?? models.orchestrator,
      budget: {
        steps: Number.isFinite(stepBudget) ? stepBudget : undefined,
        wallClockSeconds: Number.isFinite(wallBudget) ? wallBudget : undefined,
      },
    });
    await writeRunArtifact(
      ctx,
      runId,
      "summary.json",
      JSON.stringify(summary, null, 2) + "\n",
    );

    return {
      run_id: runId,
      report_count: successFiles.length,
      failure_count: failureFiles.length,
      report_files: successFiles.map((r) => r.file_name),
      failure_files: failureFiles,
      ranking_path: rankingPath,
      tokens: summary.totals,
      cost: summary.cost,
    };
  },
});
