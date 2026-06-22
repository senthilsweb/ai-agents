import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { defineAgent } from "eve";

const modelId =
  process.env.MODEL_SCOUT ??
  process.env.MODEL ??
  "openrouter/free";

const apiKey =
  process.env.MODEL_SCOUT_API_KEY ??
  process.env.MODEL_API_KEY ??
  process.env.OPENROUTER_API_KEY;

const model = apiKey
  ? createOpenAICompatible({
      name: "github-pr-digest-repository-scout",
      baseURL:
        process.env.MODEL_SCOUT_BASE_URL ??
        process.env.MODEL_BASE_URL ??
        "https://openrouter.ai/api/v1",
      apiKey,
      headers: {
        "HTTP-Referer": "https://github.com/senthilsweb/ai-agents",
        "X-Title": "Eve GitHub PR Digest",
      },
    })(modelId)
  : modelId;

export default defineAgent({
  description:
    "Collects and normalizes pull-request activity for exactly one GitHub repository using a deterministic GitHub REST API tool.",
  model,
  modelContextWindowTokens: 32_000,
});