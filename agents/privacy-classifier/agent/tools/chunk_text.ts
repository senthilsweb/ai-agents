import { existsSync, readFileSync } from "node:fs";

import { defineTool } from "eve/tools";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { sandboxRunDir, writeRunArtifact } from "shared/lib/run.js";

import { PYTHON_BIN } from "#sandbox/sandbox.js";
import { shellQuote } from "#lib/shell.js";

// ── Semantic chunking (Chonkie, in-sandbox exec, no LLM) ───────────────────
//
// See openspec/changes/add-privacy-classifier/design.md and
// https://docs.chonkie.ai/oss/chunkers/semantic-chunker.
//
// Chunk boundaries come from embedding-similarity (Chonkie's
// SemanticChunker), not a generative model call and not a paragraph/sentence
// heuristic — still no LLM in this step. Runs as a Python CLI script inside
// this agent's own sandbox, the same pattern as Docling/Presidio.

interface ChunkingConfig {
  chunk_size?: number;
  threshold?: number;
}

function loadChunkingConfig(configPath?: string): ChunkingConfig {
  const file = configPath ?? process.env.CHUNKING_CONFIG_FILE;
  if (!file || !existsSync(file)) return {};
  try {
    return (parseYaml(readFileSync(file, "utf8")) as ChunkingConfig) ?? {};
  } catch {
    return {};
  }
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "content" in value) {
    const content = (value as { content: unknown }).content;
    if (typeof content === "string") return content;
  }
  return String(value ?? "");
}

interface RawChunk {
  index: number;
  content: string;
  tokens: number;
}

export default defineTool({
  description:
    "Split extracted.txt into semantically coherent chunks via Chonkie's " +
    "SemanticChunker (embedding-similarity boundaries, Python, run in-sandbox " +
    "via exec) — no LLM. Writes chunks.json to the run folder and returns " +
    "counts only, not chunk content, so large documents never bloat the " +
    "orchestrator's own context window. Configure via CHUNKING_CONFIG_FILE (YAML).",
  inputSchema: z.object({
    run_dir: z
      .string()
      .min(1)
      .describe("The run directory, e.g. runs/2026-07-05T14-26-27Z"),
    config_path: z
      .string()
      .optional()
      .describe(
        "Optional path to a chunking YAML config; falls back to CHUNKING_CONFIG_FILE, then built-in defaults.",
      ),
  }),
  async execute({ run_dir, config_path }, ctx) {
    const runId = run_dir.replace(/^runs\//, "").replace(/\/+$/, "");
    if (!runId || runId.includes("..") || runId.includes("/")) {
      throw new Error(`Invalid run_dir: ${run_dir}`);
    }

    const config = loadChunkingConfig(config_path);
    const chunkSize = config.chunk_size ?? 800;
    const threshold = config.threshold ?? 0.7;

    const sandbox = await ctx.getSandbox();
    const sandboxDir = sandboxRunDir(runId);
    const outputPath = `${sandboxDir}/.chunks-raw.json`;

    const command = [
      PYTHON_BIN,
      "/workspace/scripts/chunk_text.py",
      `${sandboxDir}/extracted.txt`,
      outputPath,
      String(chunkSize),
      String(threshold),
    ]
      .map((arg) => shellQuote(arg))
      .join(" ");
    await sandbox.run({ command });

    const raw = textOf(await sandbox.readTextFile({ path: outputPath }));
    const { chunks } = JSON.parse(raw) as { chunks: RawChunk[] };

    const chunkRecords = chunks.map((c) => ({
      chunk_id: `chunk-${String(c.index).padStart(4, "0")}`,
      index: c.index,
      tokens: c.tokens,
      content: c.content,
    }));

    const written = await writeRunArtifact(
      ctx,
      runId,
      "chunks.json",
      JSON.stringify({ chunks: chunkRecords }, null, 2) + "\n",
    );

    return {
      chunks_path: "chunks.json",
      host_chunks_path: written.hostPath,
      chunk_count: chunkRecords.length,
      total_tokens: chunkRecords.reduce((sum, c) => sum + c.tokens, 0),
      chunker: "chonkie-semantic",
      config_used: { chunk_size: chunkSize, threshold },
    };
  },
});
