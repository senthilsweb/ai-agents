import { defineTool } from "eve/tools";
import { z } from "zod";

import { matchBandFor, scoreJobFit } from "#lib/scoring.js";
import { JobAnalysisSchema } from "#lib/schemas.js";

// ── Thin wrapper over the pure formula (agent/lib/scoring.ts) ─────────────
//
// See openspec/changes/add-job-matcher/design.md. The formula itself is
// pinned by evals/scoring_determinism.eval.ts and evals/match_banding.eval.ts
// (Bolt 1), which import agent/lib/scoring.ts directly — this tool exists
// only so the orchestrator can call the same logic without duplicating it.
// No LLM. This is the ONLY place a numeric score is produced.

export default defineTool({
  description:
    "Deterministically compute the 100-point score breakdown and match " +
    "band from a JobAnalysis's skill counts and alignment levels. Pure " +
    "function — no LLM. The orchestrator and the job-analyst subagent " +
    "never emit a score themselves; this tool is the only source of one.",
  inputSchema: z.object({
    analysis: JobAnalysisSchema,
  }),
  execute({ analysis }) {
    const breakdown = scoreJobFit({
      requiredSkills: analysis.required_skills,
      preferredSkills: analysis.preferred_skills,
      experienceAlignment: analysis.experience_alignment,
      domainAlignment: analysis.domain_alignment,
    });
    return {
      score_breakdown: breakdown,
      match_status: matchBandFor(breakdown.total_score),
    };
  },
});
