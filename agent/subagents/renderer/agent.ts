import { defineAgent } from "eve";
import { resolveModel, MODEL_RENDERER } from "#shared/model.js";

// ── Renderer subagent ─────────────────────────────────────────────────────
// Produces HTML diagrams from a Diagram Spec. Configured independently via
// MODEL_RENDERER* env vars (fallback to MODEL*). Use a fast, non-reasoning
// model here — rendering is execution-heavy, not reasoning-heavy. A reasoning
// model (e.g. GLM-5.2) tends to loop indefinitely on the rendering task.
//
// This subagent has its OWN isolated sandbox — it cannot read the orchestrator's
// files. The orchestrator passes the full spec JSON in the delegation message.
// The renderer returns the full HTML content in its response; the orchestrator
// writes it to the run folder.
const model = resolveModel(MODEL_RENDERER);

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
