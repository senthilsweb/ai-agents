import { defineAgent } from "eve";
import { resolveModel } from "shared/lib/model.js";

// Fast, non-reasoning-class model, resolved from MODEL_SCOUT. Heavy reasoning /
// frontier models must never back a subagent (risk of runaway chain-of-thought).
// See openspec/adr/0001 §4.
const model = resolveModel("scout", {
  providerName: "github-pr-digest-repository-scout",
});

export default defineAgent({
  description:
    "Collects and normalizes pull-request activity for exactly one GitHub repository using a deterministic GitHub REST API tool.",
  model,
  modelContextWindowTokens: 32_000,
});