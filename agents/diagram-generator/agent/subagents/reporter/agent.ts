import { defineAgent } from "eve";
import { resolveModel, MODEL_REPORTER } from "#lib/model.js";

// ── Reporter subagent ─────────────────────────────────────────────────────
// Aggregates a run's phase traces into report.md + summary.json. Configured
// independently via MODEL_REPORTER* env vars (fallback to MODEL*). A fast,
// non-reasoning model is ideal here — the reporter does structured data
// aggregation, not open-ended reasoning.
//
// This subagent has its OWN isolated sandbox. The orchestrator passes all
// phase traces + run metadata in the delegation message. The reporter returns
// the full report.md and summary.json content in its response.
const model = resolveModel(MODEL_REPORTER);

export default defineAgent({
  description:
    "Reporter — aggregates a run's phase traces into report.md and summary.json " +
    "with timing, token, and cost metrics. Receives all phase traces and run " +
    "metadata in the message, computes the report, and returns the full content. " +
    "Use a fast non-reasoning model for this role.",
  model,
  modelContextWindowTokens: Number(
    process.env.MODEL_REPORTER_CONTEXT_WINDOW_TOKENS ??
      process.env.MODEL_CONTEXT_WINDOW_TOKENS ??
      "128000",
  ),
  compaction: {
    thresholdPercent: 0.75,
  },
});
