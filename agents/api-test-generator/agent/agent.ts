import { defineAgent } from "eve";
import { resolveModel } from "shared/lib/model.js";

// ── Orchestrator model ────────────────────────────────────────────────────
// The orchestrator coordinates all phases: it calls deterministic tools in
// sequence, delegates complex reasoning to the Pairwise Designer (Opus) and
// bulk generation to the Assertion Writer (Haiku). It never does heavy
// combinatorial reasoning itself — that is intentionally delegated to the
// right-sized model.
//
// Configure via MODEL_ORCHESTRATOR* env vars, with fallback to MODEL*.
// No built-in default — an unset role fails loudly. See .env.example.
const model = resolveModel("orchestrator", {
  providerName: "api-test-generator-orchestrator",
});

export default defineAgent({
  model,
  modelContextWindowTokens: Number(
    process.env.MODEL_ORCHESTRATOR_CONTEXT_WINDOW_TOKENS ??
      process.env.MODEL_CONTEXT_WINDOW_TOKENS ??
      "200000",
  ),
  compaction: {
    thresholdPercent: 0.75,
  },
});
