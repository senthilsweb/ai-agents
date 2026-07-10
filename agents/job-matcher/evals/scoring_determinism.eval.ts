import { defineEval } from "eve/evals";
import { equals } from "eve/evals/expect";

import { scoreJobFit, type ScoringInput } from "#lib/scoring.js";
import type { SkillMatch } from "#lib/schemas.js";

// ── Scoring formula, pinned before agent/tools/score_job_fit.ts exists ────
//
// See evals/rubrics.md §"scoring_determinism.eval.ts" and §0 (the canonical
// formula). No live model: this eval imports the pure function directly and
// asserts exact expected ScoreBreakdowns, including the empty-preferred
// reallocation rule and an exact-.5 rounding edge, then re-runs one case to
// pin that identical input always yields identical output.

function mkSkills(matched: number, total: number): SkillMatch[] {
  if (matched > total) throw new Error("matched cannot exceed total in a fixture");
  return Array.from({ length: total }, (_, i) => ({
    skill: `skill_${i}`,
    matched: i < matched,
    evidence: i < matched ? `resume quote for skill_${i}` : "",
  }));
}

const allMatched: ScoringInput = {
  requiredSkills: mkSkills(5, 5),
  preferredSkills: mkSkills(3, 3),
  experienceAlignment: "exact",
  domainAlignment: "exact",
};

const noneMatched: ScoringInput = {
  requiredSkills: mkSkills(0, 4),
  preferredSkills: mkSkills(0, 2),
  experienceAlignment: "far",
  domainAlignment: "none",
};

const emptyPreferredReallocation: ScoringInput = {
  requiredSkills: mkSkills(5, 6),
  preferredSkills: [],
  experienceAlignment: "close",
  domainAlignment: "related",
};

const roundingEdges: ScoringInput = {
  // 7/9 * 40 = 31.111... -> 31
  requiredSkills: mkSkills(7, 9),
  // 1/8 * 20 = 2.5 exactly -> pins Math.round(2.5) = 3 forever
  preferredSkills: mkSkills(1, 8),
  experienceAlignment: "partial",
  domainAlignment: "transferable",
};

export default defineEval({
  description:
    "The scoring formula (agent/lib/scoring.ts) matches evals/rubrics.md " +
    "exactly: all-matched, none-matched, empty-preferred reallocation, " +
    "rounding edges including an exact .5 case, and same-input determinism.",
  async test(t) {
    t.check(
      scoreJobFit(allMatched),
      equals({
        required_skills_score: 40,
        preferred_skills_score: 20,
        experience_score: 20,
        domain_score: 20,
        total_score: 100,
      }),
    );

    t.check(
      scoreJobFit(noneMatched),
      equals({
        required_skills_score: 0,
        preferred_skills_score: 0,
        experience_score: 5,
        domain_score: 5,
        total_score: 10,
      }),
    );

    // No preferred skills -> the 20-point preferred budget reallocates to
    // required (budget becomes 60), never divides by zero, never awards
    // free points for the missing category.
    t.check(
      scoreJobFit(emptyPreferredReallocation),
      equals({
        required_skills_score: 50, // round(5/6 * 60) = round(50.0)
        preferred_skills_score: 0,
        experience_score: 15,
        domain_score: 15,
        total_score: 80,
      }),
    );

    t.check(
      scoreJobFit(roundingEdges),
      equals({
        required_skills_score: 31, // round(7/9 * 40) = round(31.111...)
        preferred_skills_score: 3, // round(1/8 * 20) = round(2.5)
        experience_score: 10,
        domain_score: 10,
        total_score: 54,
      }),
    );

    // Determinism: identical input, called twice, must be byte-identical.
    const first = scoreJobFit(roundingEdges);
    const second = scoreJobFit(roundingEdges);
    t.check(second, equals(first));
  },
});
