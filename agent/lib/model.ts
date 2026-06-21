import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

// ── Per-role model configuration ──────────────────────────────────────────
//
// Each agent role (orchestrator, renderer, reporter) can use a different model.
// Configure via .env with role-prefixed env vars that fall back to the generic
// MODEL* vars:
//
//   MODEL_ORCHESTRATOR             (fallback: MODEL)
//   MODEL_ORCHESTRATOR_BASE_URL    (fallback: MODEL_BASE_URL)
//   MODEL_ORCHESTRATOR_API_KEY     (fallback: MODEL_API_KEY)
//
//   MODEL_RENDERER                 (fallback: MODEL)
//   MODEL_RENDERER_BASE_URL        (fallback: MODEL_BASE_URL)
//   MODEL_RENDERER_API_KEY         (fallback: MODEL_API_KEY)
//
//   MODEL_REPORTER                 (fallback: MODEL)
//   MODEL_REPORTER_BASE_URL        (fallback: MODEL_BASE_URL)
//   MODEL_REPORTER_API_KEY         (fallback: MODEL_API_KEY)
//
// If only MODEL* is set, all three roles use the same model (backwards compat).
// If a role-specific base URL + key are absent but the generic ones are present,
// the generic provider is reused (so you can mix models from the same provider
// without repeating the key).

export const MODEL_ORCHESTRATOR = "orchestrator" as const;
export const MODEL_RENDERER = "renderer" as const;
export const MODEL_REPORTER = "reporter" as const;

export type ModelRole =
  | typeof MODEL_ORCHESTRATOR
  | typeof MODEL_RENDERER
  | typeof MODEL_REPORTER;

interface ModelConfig {
  modelId: string;
  baseURL?: string;
  apiKey?: string;
}

const DEFAULT_MODEL = "deepseek-v4-pro";
const DEFAULT_BASE_URL = "https://api.deepseek.com";

function resolveApiKey(role: ModelRole): string | undefined {
  return (
    process.env[`MODEL_${role.toUpperCase()}_API_KEY`] ??
    process.env.MODEL_API_KEY ??
    process.env.DEEPSEEK_API_KEY ??
    process.env.AI_GATEWAY_API_KEY
  );
}

function resolveBaseURL(role: ModelRole): string | undefined {
  return (
    process.env[`MODEL_${role.toUpperCase()}_BASE_URL`] ??
    process.env.MODEL_BASE_URL ??
    DEFAULT_BASE_URL
  );
}

function resolveModelId(role: ModelRole): string {
  return process.env[`MODEL_${role.toUpperCase()}`] ?? process.env.MODEL ?? DEFAULT_MODEL;
}

/**
 * Resolve the model configuration for a given role from environment variables.
 * Returns a provider-wrapped model (if base URL + key are available) or a raw
 * gateway id string (for the Vercel AI Gateway path).
 */
export function resolveModelConfig(role: ModelRole): ModelConfig {
  return {
    modelId: resolveModelId(role),
    baseURL: resolveBaseURL(role),
    apiKey: resolveApiKey(role),
  };
}

/**
 * Build a model instance for a role. When a base URL + API key are present,
 * constructs an OpenAI-compatible provider. Otherwise returns the raw model id
 * string for the Vercel AI Gateway path.
 *
 * The provider name is role-scoped (e.g. "diagram-model-renderer") so that
 * usage events and logs clearly identify which role made the call.
 */
export function resolveModel(role: ModelRole) {
  const { modelId, baseURL, apiKey } = resolveModelConfig(role);
  if (baseURL && apiKey) {
    return createOpenAICompatible({
      name: `diagram-model-${role}`,
      baseURL,
      apiKey,
    })(modelId);
  }
  // Gateway path: raw model id string (e.g. "anthropic/claude-sonnet-4.6")
  return modelId;
}

/**
 * Return the model id string for a role (for logging / metadata).
 */
export function modelIdFor(role: ModelRole): string {
  return resolveModelConfig(role).modelId;
}
