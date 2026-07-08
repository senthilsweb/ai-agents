import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { generateObject } from "ai";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { resolveModel } from "shared/lib/model.js";
import { readHostRunArtifact, sandboxRunDir, writeRunArtifact } from "shared/lib/run.js";
import { withSpan } from "shared/lib/telemetry.js";

import { mapWithConcurrency } from "#lib/concurrency.js";
import { resolvePiiEngine, usesGenai, usesPresidio } from "#lib/engine.js";
import { analyzeWithPresidio } from "#lib/presidio.js";
import { ChunkPiiDetectionResponseSchema, type RawFinding } from "#lib/schemas.js";

// ── Engine-routed PII/NPI detection ────────────────────────────────────────
//
// See openspec/changes/add-privacy-classifier/design.md.
//
// Dispatches on PII_ENGINE (validated at create_run time, re-validated here):
//   presidio                  -> Presidio only
//   presidio_genai            -> Presidio AND GenAI, findings merged
//   openai_privacy_filter     -> TODO, not yet implemented (see #lib/engine.ts)
//   genai_only                -> GenAI only, MODEL_PII_DETECTOR = a cloud model
// No declared subagent: this is a uniform, stateless, per-chunk structured-
// extraction call, made directly via the AI SDK so each call gets its own
// native telemetry span.

interface Chunk {
  chunk_id: string;
  index: number;
  tokens: number;
  content: string;
}

function defaultPromptPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "config", "detection_prompt.default.md");
}

function resolveSystemPrompt(override?: string): string {
  if (override && override.trim()) return override;
  if (process.env.PII_SYSTEM_PROMPT && process.env.PII_SYSTEM_PROMPT.trim()) {
    return process.env.PII_SYSTEM_PROMPT;
  }
  const filePath = process.env.PII_SYSTEM_PROMPT_FILE ?? defaultPromptPath();
  if (existsSync(filePath)) return readFileSync(filePath, "utf8");
  throw new Error(
    `No detection prompt available: set PII_SYSTEM_PROMPT, PII_SYSTEM_PROMPT_FILE, ` +
      `or ensure the bundled default exists at ${defaultPromptPath()}.`,
  );
}

async function detectInChunk(
  chunk: Chunk,
  model: ReturnType<typeof resolveModel>,
  systemPrompt: string,
  runId: string,
  engine: string,
): Promise<{ chunkId: string; findings: RawFinding[]; error?: string }> {
  try {
    // TelemetryOptions has no metadata field in this AI SDK version, so
    // runId/chunkId/engine ride as attributes on a wrapping custom span
    // (shared/lib/telemetry.ts) instead — the AI SDK's own generateObject
    // span nests inside it via normal OTel context propagation, so both are
    // visible together in the trace.
    const { object } = await withSpan(
      "privacy-classifier.detect_pii_genai",
      { runId, chunkId: chunk.chunk_id, engine },
      () =>
        generateObject({
          model,
          schema: ChunkPiiDetectionResponseSchema,
          system: systemPrompt,
          prompt: chunk.content,
          telemetry: {
            isEnabled: true,
            functionId: "privacy-classifier.detect_pii_genai",
          },
        }),
    );
    const findings: RawFinding[] = object.findings.map((f) => ({
      raw_label: f.raw_label,
      value_excerpt: f.value_excerpt,
      confidence: f.confidence,
      sensitivity: f.sensitivity,
      source_engine: "genai",
      chunk_id: chunk.chunk_id,
    }));
    return { chunkId: chunk.chunk_id, findings };
  } catch (error) {
    return {
      chunkId: chunk.chunk_id,
      findings: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export default defineTool({
  description:
    "Detect PII/NPI according to PII_ENGINE: presidio (local, no GenAI), " +
    "presidio_genai (both, merged), or genai_only. (openai_privacy_filter is " +
    "reserved but not yet implemented — see #lib/engine.ts.) GenAI detection " +
    "runs in parallel per chunk with a strongly-typed schema; Presidio runs " +
    "once against the full extracted text. Writes pii_raw/merged.json and " +
    "returns counts only, not raw finding content.",
  inputSchema: z.object({
    run_dir: z
      .string()
      .min(1)
      .describe("The run directory, e.g. runs/2026-07-05T14-26-27Z"),
    system_prompt: z
      .string()
      .optional()
      .describe(
        "Override the GenAI system prompt for this call (highest precedence). Falls back to PII_SYSTEM_PROMPT, then PII_SYSTEM_PROMPT_FILE, then the bundled default.",
      ),
    concurrency: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Max parallel GenAI calls; defaults to PII_DETECTION_CONCURRENCY or 5."),
  }),
  async execute({ run_dir, system_prompt, concurrency }, ctx) {
    const runId = run_dir.replace(/^runs\//, "").replace(/\/+$/, "");
    if (!runId || runId.includes("..") || runId.includes("/")) {
      throw new Error(`Invalid run_dir: ${run_dir}`);
    }

    const engine = resolvePiiEngine();
    const findings: RawFinding[] = [];
    const chunkErrors: Array<{ chunk_id: string; error: string }> = [];
    let chunksProcessed = 0;

    if (usesPresidio(engine)) {
      const sandboxDir = sandboxRunDir(runId);
      // Presidio carries no LLM tokens for the AI SDK to instrument, so its
      // latency is captured via the custom-span path instead (see
      // shared/lib/telemetry.ts).
      const presidioFindings = await withSpan(
        "privacy-classifier.detect_pii_presidio",
        { runId, engine },
        () =>
          analyzeWithPresidio(ctx, {
            sandboxTextPath: `${sandboxDir}/extracted.txt`,
            sandboxOutputPath: `${sandboxDir}/pii_raw/presidio.json`,
          }),
      );
      for (const f of presidioFindings) {
        findings.push({
          raw_label: f.entity_type,
          value_excerpt: f.text_excerpt,
          confidence: f.score,
          sensitivity: "medium",
          source_engine: "presidio",
          chunk_id: "document",
        });
      }
    }

    if (usesGenai(engine)) {
      const chunksRaw = await readHostRunArtifact(runId, "chunks.json");
      const { chunks } = JSON.parse(chunksRaw) as { chunks: Chunk[] };
      chunksProcessed = chunks.length;

      const model = resolveModel("pii_detector", {
        providerName: "privacy-classifier-pii-detector",
      });
      const systemPrompt = resolveSystemPrompt(system_prompt);
      const limit =
        concurrency ?? Number(process.env.PII_DETECTION_CONCURRENCY ?? "5");

      const results = await mapWithConcurrency(chunks, limit, (chunk) =>
        detectInChunk(chunk, model, systemPrompt, runId, engine),
      );

      for (const result of results) {
        findings.push(...result.findings);
        if (result.error) {
          chunkErrors.push({ chunk_id: result.chunkId, error: result.error });
        }
      }
    }

    await writeRunArtifact(
      ctx,
      runId,
      "pii_raw/merged.json",
      JSON.stringify({ engine, findings, chunk_errors: chunkErrors }, null, 2) + "\n",
    );

    return {
      pii_raw_path: "pii_raw/merged.json",
      engine,
      findings_count: findings.length,
      chunks_processed: chunksProcessed,
      chunk_error_count: chunkErrors.length,
    };
  },
});
