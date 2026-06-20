import { defineAgent } from "eve";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

// ── Model selection ───────────────────────────────────────────────────────
// The model is configurable via .env (loaded automatically by the eve CLI)
// so you never edit code to switch models. Set in .env / .env.local:
//
//   MODEL            = deepseek-v4-pro            # model id your provider expects
//   MODEL_BASE_URL   = https://api.deepseek.com   # OpenAI-compatible base URL
//   MODEL_API_KEY    = sk-...                     # provider API key
//
// If MODEL is a gateway id (e.g. "anthropic/claude-sonnet-4.6") and no
// MODEL_BASE_URL is set, the string is passed straight to defineAgent and
// routed through the Vercel AI Gateway (needs AI_GATEWAY_API_KEY).
//
// To use DeepSeek with the bundled default, only MODEL_API_KEY is required;
// MODEL and MODEL_BASE_URL default to DeepSeek below.
const MODEL = process.env.MODEL ?? "deepseek-v4-pro";
const MODEL_BASE_URL = process.env.MODEL_BASE_URL ?? "https://api.deepseek.com";
const MODEL_API_KEY =
  process.env.MODEL_API_KEY ??
  process.env.DEEPSEEK_API_KEY ??
  process.env.AI_GATEWAY_API_KEY;

// When a base URL + key are present, build a direct OpenAI-compatible provider
// (DeepSeek, OpenRouter, a local gateway, etc.). Otherwise fall back to a raw
// gateway id string for the Vercel AI Gateway path.
const model =
  MODEL_BASE_URL && MODEL_API_KEY
    ? createOpenAICompatible({
        name: "diagram-model",
        baseURL: MODEL_BASE_URL,
        apiKey: MODEL_API_KEY,
      })(MODEL)
    : MODEL;

export default defineAgent({
  model,
  // DeepSeek v4 Pro has a 128K context window. Override env-configurable so any
  // OpenAI-compatible provider with unknown gateway metadata still sizes
  // compaction correctly (eve's escape hatch for unlisted model ids).
  modelContextWindowTokens: Number(
    process.env.MODEL_CONTEXT_WINDOW_TOKENS ?? "128000",
  ),
  compaction: {
    // Rendering produces long HTML; compact sooner so a multi-variation run stays coherent.
    thresholdPercent: 0.75,
  },
});
