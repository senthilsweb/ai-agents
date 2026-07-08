import { defineAgent } from "eve";
import { resolveModel } from "shared/lib/model.js";

// Reasoning-class model, resolved from MODEL_ORCHESTRATOR (model-agnostic,
// env-driven, no built-in default). The orchestrator only coordinates the
// deterministic pipeline and (for GenAI engines) the pii_detector role — it
// never sees the full document text itself, only tool-returned counts and
// paths. See openspec/adr/0001-shared-agent-runtime-kit.md §4.
const model = resolveModel("orchestrator", {
  providerName: "privacy-classifier-orchestrator",
});

export default defineAgent({
  model,
  modelContextWindowTokens: Number(
    process.env.MODEL_ORCHESTRATOR_CONTEXT_WINDOW_TOKENS ??
      process.env.MODEL_CONTEXT_WINDOW_TOKENS ??
      "128000",
  ),
  compaction: { thresholdPercent: 0.75 },
});
