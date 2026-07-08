import path from "node:path";

import { defineTool } from "eve/tools";
import { z } from "zod";

import { writeBinaryRunArtifact } from "shared/lib/run.js";

const INPUTS_ROOT = "/workspace/inputs";

function textOf(value: unknown): Buffer | null {
  if (value === null || value === undefined) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  return Buffer.from(value as ArrayBufferLike);
}

export default defineTool({
  description:
    "Load the source document into the run folder, from either a staged " +
    `sandbox input (a file already placed under agent/sandbox/workspace/inputs/, ` +
    "referenced by its filename — never an arbitrary host path) or inline " +
    "base64 content (file upload). Writes source.<ext> into the run folder " +
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
        "Filename (or relative path) of the source document staged under " +
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
      const sandbox = await ctx.getSandbox();
      const sandboxSourcePath = `${INPUTS_ROOT}/${inputPath}`;
      const raw = textOf(await sandbox.readBinaryFile({ path: sandboxSourcePath }));
      if (!raw) {
        throw new Error(
          `Source file not found at ${sandboxSourcePath}. Stage it under ` +
            "agent/sandbox/workspace/inputs/ before calling load_input.",
        );
      }
      bytes = raw;
      sourceFileName = path.basename(inputPath);
    } else {
      throw new Error("Provide either path or inline_base64.");
    }

    const extension = path.extname(sourceFileName).toLowerCase();
    const written = await writeBinaryRunArtifact(
      ctx,
      runId,
      `source${extension}`,
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
