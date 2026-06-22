import { defineAgent } from "eve";
import { resolveModel } from "shared/lib/model.js";

// ── Renderer subagent ────────────────────────────────────────────
// Produces HTML diagrams from a Diagram Spec. Resolved from MODEL_RENDERER*
// (model-agnostic, env-driven, no built-in default). Use a fast, non-reasoning
// model here — rendering is execution-heavy, not reasoning-heavy. A reasoning
// model tends to loop indefinitely on the rendering task, so the renderer is
// additionally capped by RENDER_MAX_ITERATIONS and a per-render wall-clock
// budget (see this subagent's instructions).
//
// This subagent has its OWN isolated sandbox — it cannot read the orchestrator's
// files. The orchestrator passes the full spec JSON in the delegation message.
// The renderer returns the full HTML content in its response; the orchestrator
// writes it to the run folder.
const model = resolveModel("renderer", {
  providerName: "diagram-generator-renderer",
});

export default defineAgent({
  description:
    "Renderer — produces ONE stunning, self-contained HTML architecture diagram " +
    "from a Diagram Spec. Receives the full spec JSON in the message, builds the " +
    "HTML, self-verifies with a headless screenshot, and returns the full HTML " +
    "content plus a phase trace. Use a fast non-reasoning model for this role.",
  model,
  modelContextWindowTokens: Number(
    process.env.MODEL_RENDERER_CONTEXT_WINDOW_TOKENS ??
      process.env.MODEL_CONTEXT_WINDOW_TOKENS ??
      "128000",
  ),
  compaction: {
    // HTML output is large; compact sooner to stay coherent across verify iterations.
    thresholdPercent: 0.65,
  },
});
