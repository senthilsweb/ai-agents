import { defineAgent } from "eve";
import { resolveModel } from "shared/lib/model.js";

// Reasoning-class model, resolved from MODEL_ORCHESTRATOR (model-agnostic,
// env-driven, no built-in default). The orchestrator coordinates fetching,
// fan-out, and assembly — it never computes a score itself. See
// openspec/changes/add-job-matcher/design.md "Model routing" and
// openspec/adr/0001-shared-agent-runtime-kit.md §4.
const model = resolveModel("orchestrator", {
  providerName: "job-matcher-orchestrator",
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
