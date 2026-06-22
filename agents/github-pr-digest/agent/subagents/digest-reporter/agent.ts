import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { defineAgent } from "eve";

const modelId =
  process.env.MODEL_REPORTER ??
  process.env.MODEL ??
  "openrouter/free";

const apiKey =
  process.env.MODEL_REPORTER_API_KEY ??
  process.env.MODEL_API_KEY ??
  process.env.OPENROUTER_API_KEY;

const model = apiKey
  ? createOpenAICompatible({
      name: "github-pr-digest-reporter",
      baseURL:
        process.env.MODEL_REPORTER_BASE_URL ??
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
    "Combines normalized per-repository pull-request JSON into one concise, factual Markdown activity digest.",
  model,
  modelContextWindowTokens: 32_000,
});