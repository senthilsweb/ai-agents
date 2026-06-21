import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

// ── Per-role model configuration ──────────────────────────────────────────
//
// The orchestrator and reporter each use a different model.
// Configure via .env with role-prefixed env vars that fall back to the generic
// MODEL* vars:
//
//   MODEL_ORCHESTRATOR             (fallback: MODEL)
//   MODEL_ORCHESTRATOR_BASE_URL    (fallback: MODEL_BASE_URL)
//   MODEL_ORCHESTRATOR_API_KEY     (fallback: MODEL_API_KEY)
//
//   MODEL_REPORTER                 (fallback: MODEL)
//   MODEL_REPORTER_BASE_URL        (fallback: MODEL_BASE_URL)
//   MODEL_REPORTER_API_KEY         (fallback: MODEL_API_KEY)
//
// Image generation is configured separately via IMAGE_* vars:
//
//   IMAGE_MODEL                    (fallback: gpt-image-2)
//   IMAGE_BASE_URL                 (fallback: MODEL_BASE_URL or OpenAI)
//   IMAGE_API_KEY                  (fallback: MODEL_API_KEY or OPENAI_API_KEY)
//
// If only MODEL* is set, the orchestrator and reporter use the same model.

export const MODEL_ORCHESTRATOR = "ORCHESTRATOR";
export const MODEL_REVIEWER = "REVIEWER"; // kept for backward compat
export const MODEL_REPORTER = "REPORTER";

export type ModelRole = typeof MODEL_ORCHESTRATOR | typeof MODEL_REVIEWER | typeof MODEL_REPORTER;

interface ModelConfig {
  modelId: string;
  baseURL?: string;
  apiKey?: string;
}

const DEFAULT_MODEL = "glm-4.5-air";
const DEFAULT_BASE_URL = "https://api.z.ai/api/paas/v4/";

function resolveApiKey(role: ModelRole): string | undefined {
  return (
    process.env[`MODEL_${role}_API_KEY`] ??
    process.env.MODEL_API_KEY ??
    process.env.AI_GATEWAY_API_KEY
  );
}

function resolveBaseURL(role: ModelRole): string | undefined {
  return (
    process.env[`MODEL_${role}_BASE_URL`] ??
    process.env.MODEL_BASE_URL ??
    (process.env.AI_GATEWAY_API_KEY ? "https://ai-gateway.vercel.sh/v1" : DEFAULT_BASE_URL)
  );
}

function resolveModelId(role: ModelRole): string {
  return process.env[`MODEL_${role}`] ?? process.env.MODEL ?? DEFAULT_MODEL;
}

/**
 * Resolve the model configuration for a given role from environment variables.
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
 * The provider name is role-scoped so that usage events and logs clearly
 * identify which role made the call.
 */
export function resolveModel(role: ModelRole) {
  const { modelId, baseURL, apiKey } = resolveModelConfig(role);
  if (baseURL && apiKey) {
    return createOpenAICompatible({
      name: `linkedin-cover-model-${role.toLowerCase()}`,
      baseURL,
      apiKey,
    })(modelId);
  }
  if (!apiKey) {
    throw new Error(
      `Missing API key for ${role}. Set MODEL_${role}_API_KEY, MODEL_API_KEY, or AI_GATEWAY_API_KEY.`,
    );
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
