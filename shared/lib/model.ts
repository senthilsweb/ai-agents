import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";

// ── Per-role model resolution (model-agnostic, env-driven) ─────────────────
//
// See openspec/adr/0001-shared-agent-runtime-kit.md §4.
//
// Every agent role (e.g. "orchestrator", "scout", "renderer", "reporter")
// resolves its model from environment variables. Role is a free-form string;
// the env key is derived as MODEL_<ROLE> (uppercased, non-alphanumerics → "_").
//
//   MODEL_<ROLE>            (fallback: MODEL)            — REQUIRED, no default
//   MODEL_<ROLE>_BASE_URL   (fallback: MODEL_BASE_URL)   — optional
//   MODEL_<ROLE>_API_KEY    (fallback: MODEL_API_KEY,
//                                      AI_GATEWAY_API_KEY) — optional
//
// Resolution outcomes:
//   • base URL + API key present → an OpenAI-compatible provider instance.
//   • otherwise                  → the raw model id string, which Eve routes
//                                  through its AI Gateway adapter.
//
// There is intentionally NO built-in default model id. An unset role is a
// configuration error, surfaced at startup, so a run can never silently fall
// back to an unintended (and possibly expensive) model. Swap models or
// gateways entirely via .env — no code change required.

export interface ModelConfig {
  modelId: string;
  baseURL?: string;
  apiKey?: string;
}

export interface ResolveModelOptions {
  /**
   * Provider name attached to the OpenAI-compatible provider for logging and
   * usage attribution. Defaults to `eve-model-<role>`.
   */
  providerName?: string;
}

function envKeyFor(role: string): string {
  return `MODEL_${role.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
}

function resolveModelId(role: string): string {
  const key = envKeyFor(role);
  const id = process.env[key] ?? process.env.MODEL;
  if (!id || id.trim().length === 0) {
    throw new Error(
      `Model for role "${role}" is not configured. Set ${key} (or MODEL) in ` +
        `your environment. There is no default model — see ` +
        `openspec/adr/0001-shared-agent-runtime-kit.md §4.`,
    );
  }
  return id.trim();
}

function resolveBaseURL(role: string): string | undefined {
  return (
    process.env[`${envKeyFor(role)}_BASE_URL`] ?? process.env.MODEL_BASE_URL
  );
}

function resolveApiKey(role: string): string | undefined {
  return (
    process.env[`${envKeyFor(role)}_API_KEY`] ??
    process.env.MODEL_API_KEY ??
    process.env.AI_GATEWAY_API_KEY
  );
}

/**
 * Resolve the model configuration for a role from environment variables.
 * Throws if no model id is configured for the role.
 */
export function resolveModelConfig(role: string): ModelConfig {
  return {
    modelId: resolveModelId(role),
    baseURL: resolveBaseURL(role),
    apiKey: resolveApiKey(role),
  };
}

/**
 * Build a model handle for a role. When a base URL + API key are present,
 * constructs an OpenAI-compatible provider. Otherwise returns the raw model id
 * string for Eve's AI Gateway path.
 */
export function resolveModel(role: string, options: ResolveModelOptions = {}) {
  const { modelId, baseURL, apiKey } = resolveModelConfig(role);
  if (baseURL && apiKey) {
    return createOpenAICompatible({
      name: options.providerName ?? `eve-model-${role}`,
      baseURL,
      apiKey,
    })(modelId);
  }
  const anthropicKey =
    process.env[`${envKeyFor(role)}_API_KEY`] ??
    process.env.MODEL_API_KEY ??
    process.env.ANTHROPIC_API_KEY;
  if (anthropicKey && !baseURL) {
    return createAnthropic({ apiKey: anthropicKey })(modelId);
  }
  return modelId;
}

/** Return the configured model id string for a role (for logging / metadata). */
export function modelIdFor(role: string): string {
  return resolveModelConfig(role).modelId;
}
