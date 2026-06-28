import { defineAgent } from "eve";
import { resolveModel } from "shared/lib/model.js";

// ── Assertion Writer subagent ─────────────────────────────────────────────
// Bulk-generates pm.test() assertion scripts following the assertion_contract
// skill. This is the cheapest correct choice for this task: template-following
// repetitive generation that does not require complex reasoning.
//
// Using Opus or Sonnet here would waste tokens — the task is structurally
// identical across all endpoints and requires no architectural reasoning.
//
// Cap: ASSERTION_MAX_STEPS (default 20).
const model = resolveModel("assertion_writer", {
  providerName: "api-test-generator-assertion-writer",
});

export default defineAgent({
  description:
    "Assertion Writer — generates pm.test() assertion scripts for all endpoints " +
    "following the assertion_contract skill exactly. Also produces TSName " +
    "iteration labels. Fast, cheap, template-following generation. " +
    "Returns structured JSON only — no prose.",
  model,
  modelContextWindowTokens: Number(
    process.env.MODEL_ASSERTION_WRITER_CONTEXT_WINDOW_TOKENS ??
      process.env.MODEL_CONTEXT_WINDOW_TOKENS ??
      "200000",
  ),
  compaction: {
    thresholdPercent: 0.70,
  },
});
