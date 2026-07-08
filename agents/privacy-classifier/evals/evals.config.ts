import { defineEvalConfig } from "eve/evals";

// No judge model configured: every eval in this suite grades either
// deterministic tool output or a Zod schema, never LLM-as-judge prose
// grading — so evals.config.ts needs no `judge`. See openspec/changes/
// add-privacy-classifier/design.md.
export default defineEvalConfig({
  maxConcurrency: 3,
  timeoutMs: 120_000,
});
