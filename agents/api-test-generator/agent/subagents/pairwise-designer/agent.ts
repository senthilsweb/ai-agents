import { defineAgent } from "eve";
import { resolveModel } from "shared/lib/model.js";

// ── Pairwise Designer subagent ──────────────────────────────────────────────
// This is the ONLY place in the harness that uses a full reasoning model for
// complex architectural analysis. The Pairwise Designer receives the endpoint
// model and identifies the right test factors, levels, constraints, and
// must-include rows per endpoint.
//
// It does NOT perform combination math — that stays in the deterministic
// generate_pairwise_matrix tool (IPOG algorithm). This design prevents the
// reasoning model from looping on arithmetic it would do less accurately.
//
// Cap: PAIRWISE_MAX_STEPS (default 15) — single-turn task, no self-verify loop.
const model = resolveModel("pairwise_designer", {
  providerName: "api-test-generator-pairwise-designer",
});

export default defineAgent({
  description:
    "Pairwise Designer — analyzes an OpenAPI endpoint model and returns " +
    "factors_model.json: test factors, levels, constraints, and must_include rows " +
    "per endpoint. Uses full reasoning for complex combinatorial strategy. " +
    "Returns structured JSON only — no prose.",
  model,
  modelContextWindowTokens: Number(
    process.env.MODEL_PAIRWISE_DESIGNER_CONTEXT_WINDOW_TOKENS ??
      process.env.MODEL_CONTEXT_WINDOW_TOKENS ??
      "200000",
  ),
  compaction: {
    thresholdPercent: 0.70,
  },
});
