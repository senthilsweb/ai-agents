import { defineAgent } from "eve";
import { resolveModel, MODEL_ORCHESTRATOR } from "#lib/model.js";

export default defineAgent({
  model: resolveModel(MODEL_ORCHESTRATOR),
  modelContextWindowTokens: Number(process.env.MODEL_ORCHESTRATOR_CONTEXT_WINDOW_TOKENS ?? process.env.MODEL_CONTEXT_WINDOW_TOKENS ?? "128000"),
  compaction: { thresholdPercent: 0.72 },
});
