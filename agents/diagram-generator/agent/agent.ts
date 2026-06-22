import { defineAgent } from "eve";
import { resolveModel } from "shared/lib/model.js";

// ── Orchestrator model ────────────────────────────────────────────────────
// The orchestrator needs strong reasoning (spec analysis, image OCR, layout
// planning). Configure it independently via MODEL_ORCHESTRATOR* env vars,
// with fallback to the generic MODEL* vars. See .env.example.
//
// The renderer is a DECLARED SUBAGENT (agent/subagents/renderer) with its own
// agent.ts reading MODEL_RENDERER*. Report assembly is a deterministic tool
// (render_and_save_report) — there is no reporter model. See
// openspec/adr/0001-shared-agent-runtime-kit.md §4.
const model = resolveModel("orchestrator", {
  providerName: "diagram-generator-orchestrator",
});

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
