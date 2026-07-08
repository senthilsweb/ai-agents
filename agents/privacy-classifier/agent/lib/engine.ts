// ── Swappable detection engine selection ───────────────────────────────────
//
// See openspec/changes/add-privacy-classifier/design.md.
//
// Exactly one engine is active per run, selected via PII_ENGINE with no
// default (an unset or invalid value is a startup error, consistent with
// shared/lib/model.ts's "no silent default" convention).
//
// TODO(pending reference implementation): "openai_privacy_filter" is a local,
// non-generative Python package (not an LLM, despite the name) for PII
// detection. The exact package/API is still to be supplied by the repo
// owner. The engine name is reserved now so the config surface and docs
// already show all four engines, but selecting it fails fast with a clear
// message rather than silently producing incomplete results.

export const ALLOWED_PII_ENGINES = [
  "presidio",
  "presidio_genai",
  "openai_privacy_filter",
  "genai_only",
] as const;

export type PiiEngine = (typeof ALLOWED_PII_ENGINES)[number];

const NOT_YET_IMPLEMENTED: ReadonlySet<PiiEngine> = new Set(["openai_privacy_filter"]);

export function resolvePiiEngine(): PiiEngine {
  const engine = process.env.PII_ENGINE;
  if (!engine || !(ALLOWED_PII_ENGINES as readonly string[]).includes(engine)) {
    throw new Error(
      `PII_ENGINE must be set to one of ${ALLOWED_PII_ENGINES.join(", ")}. ` +
        "There is no default — see openspec/changes/add-privacy-classifier/design.md.",
    );
  }
  const resolved = engine as PiiEngine;
  if (NOT_YET_IMPLEMENTED.has(resolved)) {
    throw new Error(
      `PII_ENGINE "${resolved}" is reserved but not yet implemented (TODO: ` +
        'pending the "OpenAI Privacy Filter" reference implementation). Use ' +
        "presidio, presidio_genai, or genai_only for now.",
    );
  }
  return resolved;
}

export function usesPresidio(engine: PiiEngine): boolean {
  return engine === "presidio" || engine === "presidio_genai";
}

/** Only genai_only and presidio_genai actually call a GenAI model — openai_privacy_filter is a separate, non-LLM engine (TODO, see above). */
export function usesGenai(engine: PiiEngine): boolean {
  return engine === "presidio_genai" || engine === "genai_only";
}
