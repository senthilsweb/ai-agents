import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { defineAgent } from "eve";

const modelId =
  process.env.MODEL_REPORTER ??
  "openai/gpt-oss-20b:free";

const apiKey =
  process.env.MODEL_REPORTER_API_KEY ??
  process.env.MODEL_API_KEY ??
  process.env.OPENROUTER_API_KEY;

if (!apiKey) {
  throw new Error(
    "OPENROUTER_API_KEY, MODEL_API_KEY, or MODEL_REPORTER_API_KEY is required.",
  );
}

const model = createOpenAICompatible({
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
})(modelId);

export default defineAgent({
  description:
    "Produces one concise Markdown pull-request digest from normalized repository results.",
  model,
  modelContextWindowTokens: 32_000,
});
