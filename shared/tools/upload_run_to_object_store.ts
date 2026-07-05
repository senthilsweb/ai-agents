import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { defineTool } from "eve/tools";
import { z } from "zod";

import {
  hostRunDir,
  syncRunToHost,
  writeRunArtifact,
  type SandboxAccess,
} from "shared/lib/run.js";
import type { ObjectStoreArtifacts } from "shared/lib/summary.js";

// See openspec change `store-run-artifacts-in-object-storage`.
//
// Deterministic end-of-run upload: push the entire host run folder to an
// S3-compatible bucket (AWS S3, MinIO, or any other provider speaking the S3
// API) so remote deployments have a durable, retrievable copy of every run
// artifact. Env-gated: a no-op unless OBJECT_STORE_BUCKET is set, so local
// dev needs zero configuration. Never throws on per-file failures — partial
// results are reported in `failed`.

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".json": "application/json",
  ".md": "text/markdown",
  ".html": "text/html",
  ".txt": "text/plain",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
};

function contentTypeFor(relativePath: string): string {
  const ext = path.extname(relativePath).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/** Recursively list files under `dir`, returned as POSIX-style relative paths. */
async function walkFiles(dir: string, prefix = ""): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(path.join(dir, entry.name), rel)));
    } else if (entry.isFile()) {
      files.push(rel);
    }
  }
  return files;
}

function publicUrlFor(relativeKey: string): string | undefined {
  const base = process.env.OBJECT_STORE_PUBLIC_BASE_URL;
  if (!base) return undefined;
  return `${base.replace(/\/$/, "")}/${relativeKey}`;
}

interface UploadedEntry {
  path: string;
  size: number;
  publicUrl?: string;
}

interface FailedEntry {
  path: string;
  error: string;
}

export default defineTool({
  description:
    "Upload the entire run folder (runs/<runId>/, every file recursively) to " +
    "an S3-compatible object store (AWS S3, MinIO, ...). No-op when " +
    "OBJECT_STORE_BUCKET is not configured — expected and normal for local " +
    "dev. Call once, after sync_run_to_host. Returns the bucket, key prefix, " +
    "and per-file upload results; never fails the run on upload errors.",
  inputSchema: z.object({
    run_dir: z
      .string()
      .min(1)
      .describe("The run directory, e.g. runs/2026-07-05T14-26-27Z"),
  }),
  async execute({ run_dir }, ctx) {
    const runId = run_dir.replace(/^runs\//, "").replace(/\/+$/, "");
    if (!runId || runId.includes("..") || runId.includes("/")) {
      return {
        uploaded: [] as UploadedEntry[],
        failed: [] as FailedEntry[],
        skipped: [{ reason: `invalid run_dir: ${run_dir}` }],
      };
    }

    const bucket = process.env.OBJECT_STORE_BUCKET;
    if (!bucket) {
      return {
        uploaded: [] as UploadedEntry[],
        failed: [] as FailedEntry[],
        skipped: [{ reason: "object store not configured" }],
      };
    }

    const hostDir = hostRunDir(runId);
    let files = await walkFiles(hostDir);

    // Durable-execution fallback (design §8.2): the host mirror lives in /tmp
    // on serverless deployments and may not survive between workflow steps.
    // When it is missing or empty, refresh it from the sandbox (the same
    // source sync_run_to_host copies from), then re-walk.
    if (files.length === 0) {
      try {
        await syncRunToHost(ctx as SandboxAccess, runId);
      } catch {
        // fall through — the walk below reports what exists
      }
      files = await walkFiles(hostDir);
    }
    if (files.length === 0) {
      return {
        uploaded: [] as UploadedEntry[],
        failed: [] as FailedEntry[],
        skipped: [{ reason: `no files found for run ${runId}` }],
      };
    }

    const client = new S3Client({
      region: process.env.OBJECT_STORE_REGION ?? "us-east-1",
      ...(process.env.OBJECT_STORE_ACCESS_KEY_ID &&
      process.env.OBJECT_STORE_SECRET_ACCESS_KEY
        ? {
            credentials: {
              accessKeyId: process.env.OBJECT_STORE_ACCESS_KEY_ID,
              secretAccessKey: process.env.OBJECT_STORE_SECRET_ACCESS_KEY,
            },
          }
        : {}),
      ...(process.env.OBJECT_STORE_ENDPOINT
        ? { endpoint: process.env.OBJECT_STORE_ENDPOINT }
        : {}),
      forcePathStyle: process.env.OBJECT_STORE_FORCE_PATH_STYLE === "true",
    });

    const prefix = `runs/${runId}/`;
    const uploaded: UploadedEntry[] = [];
    const failed: FailedEntry[] = [];

    async function putFile(rel: string): Promise<void> {
      const key = `${prefix}${rel}`;
      try {
        const body = await readFile(path.join(hostDir, rel));
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentType: contentTypeFor(rel),
          }),
        );
        uploaded.push({
          path: rel,
          size: body.byteLength,
          ...(publicUrlFor(key) ? { publicUrl: publicUrlFor(key) } : {}),
        });
      } catch (error) {
        failed.push({
          path: rel,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Upload everything except summary.json first; summary.json goes last,
    // patched with the upload manifest (design §8.1), so the bucket copy
    // describes the upload it belongs to.
    const summaryRel = files.find((f) => f === "summary.json");
    for (const rel of files.filter((f) => f !== "summary.json")) {
      await putFile(rel);
    }

    if (summaryRel) {
      try {
        const summaryPath = path.join(hostDir, summaryRel);
        const summary = JSON.parse(await readFile(summaryPath, "utf8")) as {
          artifacts?: { objectStore?: ObjectStoreArtifacts };
          [key: string]: unknown;
        };
        summary.artifacts = {
          ...(summary.artifacts ?? {}),
          objectStore: { bucket, prefix, uploaded },
        };
        // writeRunArtifact mirrors the patched summary to host + sandbox so
        // every copy agrees before the bucket upload.
        await writeRunArtifact(
          ctx as SandboxAccess,
          runId,
          summaryRel,
          JSON.stringify(summary, null, 2) + "\n",
        );
      } catch {
        // patch is best-effort; the unpatched summary still uploads below
      }
      await putFile(summaryRel);
    }

    return { bucket, prefix, uploaded, failed, skipped: [] as { reason: string }[] };
  },
});
