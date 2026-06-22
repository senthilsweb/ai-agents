import { defineAgent } from "eve";
import { resolveModel } from "shared/lib/model.js";

// Reasoning- and vision-capable model, resolved from MODEL_ORCHESTRATOR
// (model-agnostic, env-driven, no built-in default). The orchestrator runs a
// single bounded creative pass to author cover-spec.json. See
// openspec/adr/0001-shared-agent-runtime-kit.md §4.
const model = resolveModel("orchestrator", {
  providerName: "linkedin-cover-orchestrator",
});

export default defineAgent({
  model,
  modelContextWindowTokens: Number(
    process.env.MODEL_ORCHESTRATOR_CONTEXT_WINDOW_TOKENS ??
      process.env.MODEL_CONTEXT_WINDOW_TOKENS ??
      "128000",
  ),
  compaction: { thresholdPercent: 0.72 },
});
