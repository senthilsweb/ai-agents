import path from "node:path";

import { defineTool } from "eve/tools";
import { z } from "zod";

import { writeBinaryRunArtifact } from "shared/lib/run.js";

// Reused from agents/privacy-classifier/agent/tools/load_input.ts (same
// staged-path/inline-base64 contract, same path-confinement guards), per
// design.md's "reuse privacy-classifier's load_input implementation".
//
// Security baseline additions (2026-07-10, see design.md "Security
// baseline"): the original had no size cap and no extension allowlist —
// job-matcher adds both, since a resume is always a small, specifically-
// typed document (unlike privacy-classifier's broader "any uploaded
// document" scope, where an allowlist would have been a real functional
// restriction rather than a pure hardening).

const INPUTS_ROOT = "/workspace/inputs";
const MAX_RESUME_BYTES = 20_000_000; // 20MB — generous for any real resume
const ALLOWED_EXTENSIONS = new Set([".pdf", ".docx", ".doc", ".txt", ".md", ".markdown"]);

function textOf(value: unknown): Buffer | null {
  if (value === null || value === undefined) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  return Buffer.from(value as ArrayBufferLike);
}

export default defineTool({
  description:
    "Load the resume into the run folder, from either a staged sandbox " +
    "input (a file already placed under agent/sandbox/workspace/inputs/, " +
    "referenced by its filename — never an arbitrary host path) or inline " +
    "base64 content (file upload). Writes resume.<ext> into the run folder " +
    "(mirrored to sandbox + host) and returns its sandbox path plus basic " +
    "file metadata. Call after create_run.",
  inputSchema: z.object({
    run_dir: z
      .string()
      .min(1)
      .describe("The run directory, e.g. runs/2026-07-05T14-26-27Z"),
    path: z
      .string()
      .optional()
      .refine((p) => p === undefined || (!p.startsWith("/") && !p.split("/").includes("..")), {
        message: "path must be a bare filename or relative path under inputs/, with no '..'",
      })
      .describe(
        "Filename (or relative path) of the resume staged under " +
          "agent/sandbox/workspace/inputs/ — not a host filesystem path.",
      ),
    inline_base64: z
      .string()
      .optional()
      .describe("Base64-encoded file content, for uploads."),
    file_name: z
      .string()
      .optional()
      .describe(
        "Original file name; required when using inline_base64, used to derive the extension.",
      ),
  }),
  async execute({ run_dir, path: inputPath, inline_base64, file_name }, ctx) {
    const runId = run_dir.replace(/^runs\//, "").replace(/\/+$/, "");
    if (!runId || runId.includes("..") || runId.includes("/")) {
      throw new Error(`Invalid run_dir: ${run_dir}`);
    }

    let bytes: Buffer;
    let sourceFileName: string;

    if (inline_base64) {
      if (!file_name) {
        throw new Error("file_name is required when using inline_base64.");
      }
      bytes = Buffer.from(inline_base64, "base64");
      sourceFileName = file_name;
    } else if (inputPath) {
      // The documented prompt convention is "resume at inputs/<file>"
      // (README, deck, the owner's own phrasing), so tolerate one leading
      // "inputs/" segment rather than resolving to /workspace/inputs/inputs/.
      const normalizedPath = inputPath.replace(/^inputs\//, "");
      const sandbox = await ctx.getSandbox();
      const sandboxSourcePath = `${INPUTS_ROOT}/${normalizedPath}`;
      const raw = textOf(await sandbox.readBinaryFile({ path: sandboxSourcePath }));
      if (!raw) {
        throw new Error(
          `Resume not found at ${sandboxSourcePath}. Stage it under ` +
            "agent/sandbox/workspace/inputs/ before calling load_input.",
        );
      }
      bytes = raw;
      sourceFileName = path.basename(normalizedPath);
    } else {
      throw new Error("Provide either path or inline_base64.");
    }

    if (bytes.byteLength > MAX_RESUME_BYTES) {
      throw new Error(
        `Resume is ${bytes.byteLength} bytes, exceeding the ${MAX_RESUME_BYTES}-byte cap.`,
      );
    }
    const extension = path.extname(sourceFileName).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      throw new Error(
        `Unsupported resume extension "${extension}". Allowed: ${[...ALLOWED_EXTENSIONS].join(", ")}.`,
      );
    }
    const written = await writeBinaryRunArtifact(
      ctx,
      runId,
      `resume${extension}`,
      bytes,
    );

    return {
      sandbox_path: written.sandboxPath,
      host_path: written.hostPath,
      file_name: sourceFileName,
      extension,
      size_bytes: bytes.byteLength,
    };
  },
});
