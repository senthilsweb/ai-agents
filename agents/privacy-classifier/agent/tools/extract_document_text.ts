import { defineTool } from "eve/tools";
import { z } from "zod";

import { sandboxRunDir, writeRunArtifact } from "shared/lib/run.js";

import { PYTHON_BIN } from "#sandbox/sandbox.js";
import { shellQuote } from "#lib/shell.js";

// ── Deterministic text extraction (Docling, in-sandbox exec, no LLM) ──────
//
// See openspec/changes/add-privacy-classifier/design.md.

const PASSTHROUGH_EXTENSIONS = new Set([".txt", ".md", ".markdown"]);
const DOCLING_EXTENSIONS = new Set([
  ".pdf",
  ".docx",
  ".doc",
  ".html",
  ".htm",
  ".png",
  ".jpg",
  ".jpeg",
  ".tiff",
  ".tif",
  ".bmp",
]);

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "content" in value) {
    const content = (value as { content: unknown }).content;
    if (typeof content === "string") return content;
  }
  return String(value ?? "");
}

export default defineTool({
  description:
    "Deterministically extract plain text from the run's source document. " +
    "TXT/Markdown pass through directly. PDF, DOCX, HTML, and images go " +
    "through Docling (Python, run in-sandbox via exec) with automatic local " +
    "OCR fallback for scanned/image content — no hosted API, no LLM. Writes " +
    "extracted.txt to the run folder and returns metadata only.",
  inputSchema: z.object({
    run_dir: z
      .string()
      .min(1)
      .describe("The run directory, e.g. runs/2026-07-05T14-26-27Z"),
    sandbox_path: z
      .string()
      .min(1)
      .describe("Sandbox path to the source file, from load_input."),
    extension: z
      .string()
      .describe("File extension including the dot, e.g. '.pdf', from load_input."),
  }),
  async execute({ run_dir, sandbox_path, extension }, ctx) {
    const runId = run_dir.replace(/^runs\//, "").replace(/\/+$/, "");
    if (!runId || runId.includes("..") || runId.includes("/")) {
      throw new Error(`Invalid run_dir: ${run_dir}`);
    }
    const ext = extension.toLowerCase();
    const sandbox = await ctx.getSandbox();

    let text: string;
    let extractionMethod: string;
    let pageCount: number | undefined;
    const ocrEnabled = DOCLING_EXTENSIONS.has(ext);

    if (PASSTHROUGH_EXTENSIONS.has(ext)) {
      text = textOf(await sandbox.readTextFile({ path: sandbox_path }));
      extractionMethod = "passthrough";
    } else if (ocrEnabled) {
      const sandboxDir = sandboxRunDir(runId);
      const textOutPath = `${sandboxDir}/.extracted-raw.txt`;
      const metaOutPath = `${sandboxDir}/.extracted-meta.json`;

      const command = [
        PYTHON_BIN,
        "/workspace/scripts/extract_document.py",
        sandbox_path,
        textOutPath,
        metaOutPath,
      ]
        .map((arg) => shellQuote(arg))
        .join(" ");
      await sandbox.run({ command });

      text = textOf(await sandbox.readTextFile({ path: textOutPath }));
      const metaRaw = textOf(await sandbox.readTextFile({ path: metaOutPath }));
      const meta = JSON.parse(metaRaw) as {
        page_count?: number;
        extraction_method?: string;
      };
      pageCount = meta.page_count ?? undefined;
      extractionMethod = meta.extraction_method ?? "docling";
    } else {
      throw new Error(`Unsupported extension for extraction: ${ext}`);
    }

    const written = await writeRunArtifact(ctx, runId, "extracted.txt", text);

    return {
      extracted_text_path: "extracted.txt",
      host_extracted_text_path: written.hostPath,
      char_count: text.length,
      page_count: pageCount,
      extraction_method: extractionMethod,
      ocr_enabled: ocrEnabled,
    };
  },
});
