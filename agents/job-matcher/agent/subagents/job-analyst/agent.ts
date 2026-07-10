import { defineAgent } from "eve";
import { resolveModel } from "shared/lib/model.js";

import { JobAnalysisSchema } from "#lib/schemas.js";

// ── Job Analyst subagent (N>1 fan-out path) ────────────────────────────────
//
// See openspec/changes/add-job-matcher/design.md "Fan-out / loop policy".
// The orchestrator delegates to a copy of this subagent once per job link
// when there is more than one — each delegation is a genuinely separate
// child session (its own child sandbox default, own conversation history),
// which is what gives each job link its own trace (design.md's per-job-
// trace requirement) without any custom span bookkeeping.
//
// outputSchema runs this subagent in task mode: eve validates its reply
// against JobAnalysisSchema and returns the typed result as the tool call's
// output, no raw-JSON-in-prose parsing needed by the orchestrator. Resolves
// the same MODEL_JOB_ANALYST role as the N=1 direct-call tool
// (agent/tools/analyze_job_fit.ts), so single-job and multi-job runs use
// the same model.
const model = resolveModel("job_analyst", {
  providerName: "job-matcher-job-analyst",
});

export default defineAgent({
  description:
    "Job Analyst — analyzes the resume against exactly one job posting and " +
    "returns a typed JobAnalysis: matched/missing skills with resume-" +
    "quoted evidence, experience and domain alignment, strengths, gaps, " +
    "improvements, ATS keywords, and cover-letter content. Never produces " +
    "a score. Delegate once per job link when there is more than one job " +
    "in the run.",
  model,
  outputSchema: JobAnalysisSchema,
  modelContextWindowTokens: Number(
    process.env.MODEL_JOB_ANALYST_CONTEXT_WINDOW_TOKENS ??
      process.env.MODEL_CONTEXT_WINDOW_TOKENS ??
      "128000",
  ),
  compaction: { thresholdPercent: 0.75 },
});
