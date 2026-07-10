import { defineEval } from "eve/evals";
import { equals } from "eve/evals/expect";

import { matchBandFor } from "#lib/scoring.js";

// ── Match band boundaries, pinned before any tool calls this function ─────
//
// See evals/rubrics.md §"match_banding.eval.ts": totals 100, 80, 79, 65, 64,
// 50, 49, 35, 34, 0 must land in exactly strong, strong, good, good,
// moderate, moderate, weak, weak, no_match, no_match. No live model.

const CASES: Array<[number, string]> = [
  [100, "strong_match"],
  [80, "strong_match"],
  [79, "good_match"],
  [65, "good_match"],
  [64, "moderate_match"],
  [50, "moderate_match"],
  [49, "weak_match"],
  [35, "weak_match"],
  [34, "no_match"],
  [0, "no_match"],
];

export default defineEval({
  description:
    "Match band boundaries (80/65/50/35) land exactly on the rubric's " +
    "table, at every edge value on both sides of each threshold.",
  async test(t) {
    for (const [totalScore, expectedBand] of CASES) {
      t.check(matchBandFor(totalScore), equals(expectedBand));
    }
  },
});
