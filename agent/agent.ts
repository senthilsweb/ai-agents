import { defineAgent } from "eve";
import { resolveModel, MODEL_ORCHESTRATOR } from "#lib/model.js";

// ── Orchestrator model ────────────────────────────────────────────────────
// The orchestrator needs strong reasoning (spec analysis, image OCR, layout
// planning). Configure it independently via MODEL_ORCHESTRATOR* env vars,
// with fallback to the generic MODEL* vars. See .env.example.
//
// The renderer and reporter are DECLARED SUBAGENTS (agent/subagents/renderer,
// agent/subagents/reporter) — each has its own agent.ts reading MODEL_RENDERER*
// and MODEL_REPORTER* respectively. This lets you use a reasoning model for
// orchestration and a fast, cheap model for rendering/reporting.
const model = resolveModel(MODEL_ORCHESTRATOR);

export default defineAgent({
  model,
  modelContextWindowTokens: Number(
    process.env.MODEL_ORCHESTRATOR_CONTEXT_WINDOW_TOKENS ??
      process.env.MODEL_CONTEXT_WINDOW_TOKENS ??
      "128000",
  ),
  compaction: {
    thresholdPercent: 0.75,
  },
});
