import type { SandboxAccess } from "shared/lib/run.js";

import { PYTHON_BIN } from "#sandbox/sandbox.js";
import { shellQuote } from "#lib/shell.js";

// ── Presidio invocation (Python, in-sandbox exec, no LLM) ──────────────────
//
// See openspec/changes/add-privacy-classifier/design.md.
//
// A plain function (not a defineTool) so both detect_privacy_entities.ts
// (the real pipeline) and detect_pii_presidio.ts (a thin standalone tool for
// testing/evals) share exactly one implementation.

export interface PresidioFinding {
  entity_type: string;
  start: number;
  end: number;
  score: number;
  text_excerpt: string;
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "content" in value) {
    const content = (value as { content: unknown }).content;
    if (typeof content === "string") return content;
  }
  return String(value ?? "");
}

export interface AnalyzeWithPresidioOptions {
  sandboxTextPath: string;
  sandboxOutputPath: string;
  language?: string;
  scoreThreshold?: number;
}

/** Run Presidio against the full extracted text. No chunking — Presidio has no context-window limit. */
export async function analyzeWithPresidio(
  ctx: SandboxAccess,
  options: AnalyzeWithPresidioOptions,
): Promise<PresidioFinding[]> {
  const sandbox = await ctx.getSandbox();
  const language = options.language ?? process.env.PRESIDIO_LANGUAGE ?? "en";
  const scoreThreshold =
    options.scoreThreshold ?? Number(process.env.PRESIDIO_SCORE_THRESHOLD ?? "0.4");

  const command = [
    PYTHON_BIN,
    "/workspace/scripts/presidio_analyze.py",
    options.sandboxTextPath,
    options.sandboxOutputPath,
    language,
    String(scoreThreshold),
  ]
    .map((arg) => shellQuote(arg))
    .join(" ");

  await sandbox.run({ command });

  const raw = textOf(await sandbox.readTextFile({ path: options.sandboxOutputPath }));
  const parsed = JSON.parse(raw) as { findings: PresidioFinding[] };
  return parsed.findings;
}
