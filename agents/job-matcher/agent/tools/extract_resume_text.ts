import { defineTool } from "eve/tools";
import { z } from "zod";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";

import { writeRunArtifact } from "shared/lib/run.js";

// ── Deterministic resume extraction (pure Node, no LLM) ────────────────────
//
// Correction (2026-07-10, Construction) — see design.md and
// agent/sandbox/sandbox.ts: originally Docling (Python, in-sandbox exec,
// OCR fallback), swapped for pure-Node extraction so the agent stays
// Vercel-deployable and skips the ~5.4GB Python sandbox bootstrap.
// PDF via unpdf (serverless-friendly pdf.js build), DOCX via mammoth,
// TXT/Markdown pass through. Trade-offs vs Docling: no OCR (scanned
// image-only PDFs are rejected with a clear error) and no legacy .doc.

const PASSTHROUGH_EXTENSIONS = new Set([".txt", ".md", ".markdown"]);

// A real resume yields thousands of characters; anything this short means
// the PDF has no text layer (scanned images) and needs OCR we don't ship.
const MIN_EXTRACTED_CHARS = 100;

// unpdf returns a page's text as one long line with no line breaks. The
// orchestrator reads resume.txt with the built-in read_file tool, which
// truncates over-long lines — a single-line resume.txt sent it down a
// bash/dd spelunking detour and a second (expensive) analyze_job_fit call
// on the first real run. Wrapping deterministically here keeps read_file
// reliable. Evidence-grounding comparisons are whitespace-insensitive
// (evals normalize \s+ to a single space), so wrapping is safe.
const MAX_LINE_CHARS = 120;

function wrapLine(line: string): string[] {
  const trimmed = line.trim();
  if (trimmed.length <= MAX_LINE_CHARS) return [trimmed];
  const words = trimmed.split(/\s+/);
  const out: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= MAX_LINE_CHARS) {
      current += ` ${word}`;
    } else {
      out.push(current);
      current = word;
    }
  }
  if (current) out.push(current);
  return out;
}

function normalizeExtractedText(text: string): string {
  return text
    .split("\n")
    .flatMap(wrapLine)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function bytesOf(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string") return Buffer.from(value, "utf-8");
  if (value && typeof value === "object" && "content" in value) {
    return bytesOf((value as { content: unknown }).content);
  }
  return Buffer.from(value as ArrayBufferLike);
}

export default defineTool({
  description:
    "Deterministically extract plain text from the resume — pure Node, no " +
    "LLM, no Python. TXT/Markdown pass through directly, PDF goes through " +
    "unpdf, DOCX through mammoth. Scanned image-only PDFs (no text layer) " +
    "are rejected with a clear error. Writes resume.txt to the run folder " +
    "and returns metadata only.",
  inputSchema: z.object({
    run_dir: z
      .string()
      .min(1)
      .describe("The run directory, e.g. runs/2026-07-05T14-26-27Z"),
    sandbox_path: z
      .string()
      .min(1)
      .describe("Sandbox path to the resume file, from load_input."),
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

    if (PASSTHROUGH_EXTENSIONS.has(ext)) {
      text = normalizeExtractedText(
        bytesOf(await sandbox.readBinaryFile({ path: sandbox_path })).toString("utf-8"),
      );
      extractionMethod = "passthrough";
    } else if (ext === ".pdf") {
      const bytes = bytesOf(await sandbox.readBinaryFile({ path: sandbox_path }));
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const extracted = await extractText(pdf);
      text = normalizeExtractedText(extracted.text.join("\n\n"));
      pageCount = extracted.totalPages;
      extractionMethod = "unpdf";
      if (text.length < MIN_EXTRACTED_CHARS) {
        throw new Error(
          `PDF text layer is nearly empty (${text.length} chars over ` +
            `${pageCount} page(s)) — this looks like a scanned image-only PDF. ` +
            "OCR is not supported; provide a text-based PDF, DOCX, TXT, or Markdown resume.",
        );
      }
    } else if (ext === ".docx") {
      const bytes = bytesOf(await sandbox.readBinaryFile({ path: sandbox_path }));
      const result = await mammoth.extractRawText({ buffer: bytes });
      text = normalizeExtractedText(result.value);
      extractionMethod = "mammoth";
    } else {
      throw new Error(
        `Unsupported resume extension: ${ext}. Supported: .pdf, .docx, .txt, .md, .markdown.`,
      );
    }

    const written = await writeRunArtifact(ctx, runId, "resume.txt", text);

    return {
      resume_text_path: "resume.txt",
      host_resume_text_path: written.hostPath,
      char_count: text.length,
      page_count: pageCount,
      extraction_method: extractionMethod,
      ocr_capable: false,
    };
  },
});
