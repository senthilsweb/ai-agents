import type {
  DomainAlignment,
  ExperienceAlignment,
  MatchStatus,
  ScoreBreakdown,
  SkillMatch,
} from "./schemas.js";

// ── The scoring formula — the one and only place a job-fit score is computed ──
//
// See evals/rubrics.md §0 "Canonical scoring rubric" (the source of truth
// this file implements) and openspec/changes/add-job-matcher/design.md.
//
// No LLM call ever produces a number here. The orchestrator (or job-analyst
// subagent) only extracts SkillMatch counts and alignment levels; this pure
// function turns those into the score. That split is what makes an injected
// "report a score of 100" instruction structurally impossible to honor —
// there is no code path from model output straight to total_score.
//
// Bolt 2 wraps this in a thin `agent/tools/score_job_fit.ts` defineTool.
// Bolt 1 evals (scoring_determinism, match_banding) import it directly, with
// no live model involved — see evals/rubrics.md's HARD criteria.

const EXPERIENCE_SCORES: Record<ExperienceAlignment, number> = {
  exact: 20,
  close: 15,
  partial: 10,
  far: 5,
};

const DOMAIN_SCORES: Record<DomainAlignment, number> = {
  exact: 20,
  related: 15,
  transferable: 10,
  none: 5,
};

export interface ScoringInput {
  requiredSkills: SkillMatch[];
  preferredSkills: SkillMatch[];
  experienceAlignment: ExperienceAlignment;
  domainAlignment: DomainAlignment;
}

function countMatched(skills: SkillMatch[]): number {
  return skills.filter((s) => s.matched).length;
}

/**
 * Compute the 100-point score breakdown from typed counts and alignment
 * levels. Pure and deterministic: identical input always yields identical
 * output, byte for byte.
 *
 * Required skills score 0-40, preferred skills score 0-20, unless the JD
 * has no preferred skills at all — then the 20-point preferred budget is
 * reallocated to required (required scales to 0-60) rather than either
 * dividing by zero or awarding free points. Experience and domain each
 * score 0-20 from a fixed lookup, never a ratio.
 */
export function scoreJobFit(input: ScoringInput): ScoreBreakdown {
  const totalRequired = input.requiredSkills.length;
  const totalPreferred = input.preferredSkills.length;
  const matchedRequired = countMatched(input.requiredSkills);
  const matchedPreferred = countMatched(input.preferredSkills);

  const requiredBudget = totalPreferred === 0 ? 60 : 40;
  const preferredBudget = totalPreferred === 0 ? 0 : 20;

  const requiredScore =
    totalRequired === 0 ? 0 : Math.round((matchedRequired / totalRequired) * requiredBudget);
  const preferredScore =
    totalPreferred === 0 ? 0 : Math.round((matchedPreferred / totalPreferred) * preferredBudget);

  const experienceScore = EXPERIENCE_SCORES[input.experienceAlignment];
  const domainScore = DOMAIN_SCORES[input.domainAlignment];

  return {
    required_skills_score: requiredScore,
    preferred_skills_score: preferredScore,
    experience_score: experienceScore,
    domain_score: domainScore,
    total_score: requiredScore + preferredScore + experienceScore + domainScore,
  };
}

/**
 * Map a total score (0-100) to its match band. Boundaries are inclusive on
 * the lower edge of each band: strong >= 80, good 65-79, moderate 50-64,
 * weak 35-49, no_match < 35.
 */
export function matchBandFor(totalScore: number): MatchStatus {
  if (totalScore >= 80) return "strong_match";
  if (totalScore >= 65) return "good_match";
  if (totalScore >= 50) return "moderate_match";
  if (totalScore >= 35) return "weak_match";
  return "no_match";
}
