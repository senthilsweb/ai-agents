import { defineAgent } from "eve";
import { resolveModel } from "shared/lib/model.js";

// Reasoning-class model, resolved from MODEL_ORCHESTRATOR (model-agnostic,
// env-driven, no built-in default). See openspec/adr/0001 §4.
const model = resolveModel("orchestrator", {
  providerName: "github-pr-digest-orchestrator",
});

export default defineAgent({
  model,
  modelContextWindowTokens: 64_000,
  compaction: {
    thresholdPercent: 0.8,
  },
});