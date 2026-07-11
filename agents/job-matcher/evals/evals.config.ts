import { defineEvalConfig } from "eve/evals";

// No judge model configured: every assertion across all 8 evals grades
// deterministic facts (schema shape, exact score equality, evidence
// substring containment, tool/subagent call counts, session ids) — never
// LLM-as-judge prose grading. See design.md and evals/rubrics.md.
//
// timeoutMs covers both kinds of eval in this suite: Bolt 1's two pure,
// model-free evals (scoring_determinism, match_banding — finish near-
// instantly) and Bolt 4's six live evals, which drive a real orchestrator
// turn and, for the multi-job fixtures, up to three job-analyst subagent
// delegations plus in-tool resume extraction — real wall-clock work.
// 300s leaves headroom for a cold sandbox template build (base image
// only, no Python — extraction is pure Node since the design.md
// Correction 3 swap) without masking a genuinely hung run.
export default defineEvalConfig({
  maxConcurrency: 3,
  timeoutMs: 300_000,
});
