import { defineEvalConfig } from "eve/evals";

// No judge model configured for the Bolt 1 evals: both grade a pure,
// deterministic function against hand-computed fixtures, never LLM-as-judge
// prose grading. Bolt 4 evals (evidence grounding, prompt injection, etc.)
// exercise the live agent and may add judge config here when they land.
// See openspec/changes/add-job-matcher/design.md and evals/rubrics.md.
export default defineEvalConfig({
  maxConcurrency: 3,
  timeoutMs: 30_000,
});
