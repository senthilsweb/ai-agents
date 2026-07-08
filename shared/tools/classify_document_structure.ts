import { defineTool } from "eve/tools";
import { z } from "zod";

// ── Deterministic document-shape gate ──────────────────────────────────────
//
// See openspec/changes/add-privacy-classifier/design.md.
//
// Classifies a file as structured_columnar (out of scope), semi_structured,
// or unstructured, using extension first and magic bytes as a fallback for
// unrecognized/absent extensions. No content parsing, no LLM. v1 deliberately
// does not sniff file content beyond magic bytes (e.g. a CSV mislabeled
// .txt is not detected) — see design.md non-goals.

const COLUMNAR_EXTENSIONS: Record<string, string> = {
  ".csv": "csv",
  ".tsv": "tsv",
  ".parquet": "parquet",
  ".xlsx": "xlsx",
  ".xls": "xls",
  ".db": "sqlite",
  ".sqlite": "sqlite",
  ".sqlite3": "sqlite",
};

const UNSTRUCTURED_EXTENSIONS: Record<string, string> = {
  ".pdf": "pdf",
  ".docx": "docx",
  ".doc": "doc",
  ".txt": "txt",
  ".md": "markdown",
  ".markdown": "markdown",
  ".html": "html",
  ".htm": "html",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".tiff": "image",
  ".tif": "image",
  ".bmp": "image",
};

const SEMI_STRUCTURED_EXTENSIONS: Record<string, string> = {
  ".json": "json",
  ".xml": "xml",
  ".yaml": "yaml",
  ".yml": "yaml",
};

function extOf(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  return dot < 0 ? "" : filePath.slice(dot).toLowerCase();
}

function bytesOf(value: unknown): Buffer {
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value && typeof value === "object" && "content" in value) {
    const content = (value as { content: unknown }).content;
    if (content instanceof Uint8Array) return Buffer.from(content);
  }
  return Buffer.alloc(0);
}

function sniffMagicBytes(
  bytes: Buffer,
): { format: string; structural_class: "structured_columnar" } | undefined {
  const sqliteHeader = Buffer.from("SQLite format 3\0", "ascii");
  if (
    bytes.length >= sqliteHeader.length &&
    bytes.subarray(0, sqliteHeader.length).equals(sqliteHeader)
  ) {
    return { format: "sqlite", structural_class: "structured_columnar" };
  }
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString("ascii") === "PAR1") {
    return { format: "parquet", structural_class: "structured_columnar" };
  }
  return undefined;
}

export default defineTool({
  description:
    "Deterministically classify a document as structured_columnar (out of " +
    "scope for this agent), semi_structured, or unstructured — by file " +
    "extension, with a magic-byte fallback for unrecognized extensions. No " +
    "LLM. Call before extraction; when in_scope is false, stop the pipeline " +
    'and report processing_status: "skipped_out_of_scope".',
  inputSchema: z.object({
    sandbox_path: z
      .string()
      .min(1)
      .describe(
        "Path to the source file inside the sandbox, e.g. /workspace/runs/<id>/source.pdf",
      ),
  }),
  async execute({ sandbox_path }, ctx) {
    const ext = extOf(sandbox_path);

    if (ext in COLUMNAR_EXTENSIONS) {
      return {
        in_scope: false,
        structural_class_hint: "structured_columnar" as const,
        detected_format: COLUMNAR_EXTENSIONS[ext],
        reason: `Extension ${ext} is a columnar/structured format, out of scope for this agent.`,
      };
    }

    if (ext in UNSTRUCTURED_EXTENSIONS) {
      return {
        in_scope: true,
        structural_class_hint: "unstructured" as const,
        detected_format: UNSTRUCTURED_EXTENSIONS[ext],
        reason: `Extension ${ext} recognized as unstructured.`,
      };
    }

    if (ext in SEMI_STRUCTURED_EXTENSIONS) {
      return {
        in_scope: true,
        structural_class_hint: "semi_structured" as const,
        detected_format: SEMI_STRUCTURED_EXTENSIONS[ext],
        reason: `Extension ${ext} recognized as semi-structured.`,
      };
    }

    const sandbox = await ctx.getSandbox();
    let head: Buffer = Buffer.alloc(0);
    try {
      if (sandbox.readBinaryFile) {
        head = bytesOf(await sandbox.readBinaryFile({ path: sandbox_path }));
      }
    } catch {
      // unreadable — fall through to the unknown-extension default below
    }

    const sniffed = head.length > 0 ? sniffMagicBytes(head) : undefined;
    if (sniffed) {
      return {
        in_scope: false,
        structural_class_hint: sniffed.structural_class,
        detected_format: sniffed.format,
        reason: `Magic bytes identified ${sniffed.format}, a columnar/structured format, out of scope.`,
      };
    }

    return {
      in_scope: true,
      structural_class_hint: "unknown" as const,
      detected_format: ext || "unknown",
      reason: `Unrecognized extension${ext ? ` "${ext}"` : ""}; no columnar signature detected, treating as unstructured by default.`,
    };
  },
});
