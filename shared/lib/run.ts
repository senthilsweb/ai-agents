import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// ── Run-folder helpers (single source of the host/sandbox mirror) ──────────
//
// See openspec/adr/0001-shared-agent-runtime-kit.md §2.
//
// Eve runs each agent turn against a sandbox. In the local/dev topology a
// subagent may execute in its own sandbox, so the host workspace run folder is
// the shared store that both the subagent and the parent renderer can see.
// Every deterministic tool writes run artifacts through `writeRunArtifact`,
// which mirrors content to BOTH the sandbox and the host run folder using ONE
// implementation — replacing the per-tool copy-back logic that was previously
// duplicated across create_run / write_run_file / fetch_pull_requests /
// render_and_save_report.
//
// `syncRunToHost` provides the canonical end-of-run copy-back primitive: it
// pulls every file in the sandbox run folder back to the host in a single call
// (backend-agnostic — no `docker cp`). It is idempotent and safe to call even
// when the host mirror already exists.

/** Minimal structural view of an Eve sandbox session (decouples from internals). */
export interface SandboxLike {
  run(opts: { command: string }): PromiseLike<unknown>;
  readTextFile(opts: { path: string }): PromiseLike<unknown>;
  readBinaryFile?(opts: { path: string }): PromiseLike<unknown>;
  writeTextFile(opts: { path: string; content: string }): PromiseLike<unknown>;
}

// Extensions copied verbatim as raw bytes (images, archives, fonts, pdfs).
// Everything else is treated as UTF-8 text. Keep lowercase, with the dot.
const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".ico",
  ".bmp",
  ".tiff",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".mp4",
  ".mov",
  ".mp3",
  ".wav",
]);

function isBinaryRelativePath(relativePath: string): boolean {
  const dot = relativePath.lastIndexOf(".");
  if (dot < 0) return false;
  return BINARY_EXTENSIONS.has(relativePath.slice(dot).toLowerCase());
}

function sandboxBytesOf(value: unknown): Buffer {
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value && typeof value === "object" && "content" in value) {
    const content = (value as { content: unknown }).content;
    if (content instanceof Uint8Array) return Buffer.from(content);
  }
  throw new Error("Sandbox readBinaryFile returned no byte content.");
}

/** Minimal structural view of a tool/hook context that can reach the sandbox. */
export interface SandboxAccess {
  getSandbox(): Promise<SandboxLike>;
}

const WORKSPACE_SEGMENTS = ["agent", "sandbox", "workspace"] as const;

/** Create a filesystem-safe, sortable UTC run id, e.g. 2026-06-22T02-15-30Z. */
export function createRunId(): string {
  return new Date()
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/:/g, "-");
}

/** Resolve the host workspace root (mirrors Eve's sandbox workspace folder). */
export function hostWorkspaceRoot(): string {
  const projectRoot = process.env.HOST_REPORT_ROOT ?? process.cwd();
  return path.resolve(projectRoot, ...WORKSPACE_SEGMENTS);
}

/** Relative run directory, e.g. `runs/<runId>`. */
export function runRelativeDir(runId: string): string {
  return `runs/${runId}`;
}

/** Absolute host run directory. */
export function hostRunDir(runId: string): string {
  return path.join(hostWorkspaceRoot(), "runs", runId);
}

/** Absolute sandbox run directory. */
export function sandboxRunDir(runId: string): string {
  return `/workspace/runs/${runId}`;
}

function assertSafeRelative(relativePath: string): string {
  const normalized = relativePath.replace(/^\/+/, "");
  if (normalized.includes("..") || normalized.length === 0) {
    throw new Error(`Unsafe run-relative path: ${relativePath}`);
  }
  return normalized;
}

/** Ensure the run directory (and optional subdirectories) exist on host + sandbox. */
export async function ensureRunDirs(
  ctx: SandboxAccess,
  runId: string,
  subdirs: string[] = [],
): Promise<void> {
  const hostDir = hostRunDir(runId);
  const sandboxDir = sandboxRunDir(runId);
  await mkdir(hostDir, { recursive: true });
  const sandbox = await ctx.getSandbox();
  const all = ["", ...subdirs];
  for (const sub of all) {
    if (sub) await mkdir(path.join(hostDir, sub), { recursive: true });
  }
  const sandboxTargets = all
    .map((sub) => (sub ? `${sandboxDir}/${sub}` : sandboxDir))
    .map((p) => JSON.stringify(p))
    .join(" ");
  await sandbox.run({ command: `mkdir -p ${sandboxTargets}` });
}

export interface WriteRunArtifactResult {
  hostPath: string;
  sandboxPath: string;
  bytes: number;
}

/**
 * Write one run artifact to BOTH the sandbox and the host run folder.
 * `relativePath` is relative to the run directory, e.g. `report.md` or
 * `repositories/owner__repo.json`.
 */
export async function writeRunArtifact(
  ctx: SandboxAccess,
  runId: string,
  relativePath: string,
  content: string,
): Promise<WriteRunArtifactResult> {
  const rel = assertSafeRelative(relativePath);
  const hostDir = hostRunDir(runId);
  const hostPath = path.join(hostDir, rel);
  const hostWorkspace = hostWorkspaceRoot();
  if (!path.resolve(hostPath).startsWith(`${hostWorkspace}${path.sep}`)) {
    throw new Error("Resolved host path escapes the workspace.");
  }

  await mkdir(path.dirname(hostPath), { recursive: true });
  await writeFile(hostPath, content, "utf8");

  const sandboxPath = `${sandboxRunDir(runId)}/${rel}`;
  const sandbox = await ctx.getSandbox();
  await sandbox.run({
    command: `mkdir -p ${JSON.stringify(path.posix.dirname(sandboxPath))}`,
  });
  await sandbox.writeTextFile({ path: sandboxPath, content });

  return { hostPath, sandboxPath, bytes: Buffer.byteLength(content, "utf8") };
}

/** Read one run artifact from the host run folder. */
export async function readHostRunArtifact(
  runId: string,
  relativePath: string,
): Promise<string> {
  const rel = assertSafeRelative(relativePath);
  return readFile(path.join(hostRunDir(runId), rel), "utf8");
}

function sandboxTextOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "content" in value) {
    const content = (value as { content: unknown }).content;
    if (typeof content === "string") return content;
  }
  return String(value ?? "");
}

export interface SyncRunToHostResult {
  runId: string;
  hostRunDirectory: string;
  copied: string[];
  skipped: Array<{ path: string; error: string }>;
}

/**
 * Canonical end-of-run copy-back: pull every file in the sandbox run folder
 * back to the host run folder in a single call. Backend-agnostic and
 * idempotent. Text artifacts are copied verbatim as UTF-8; known binary
 * artifacts (e.g. cover.png, *.pdf) are copied as raw bytes via the sandbox
 * binary read API, so images survive the round trip.
 */
export async function syncRunToHost(
  ctx: SandboxAccess,
  runId: string,
): Promise<SyncRunToHostResult> {
  const sandbox = await ctx.getSandbox();
  const rel = runRelativeDir(runId);
  const listMarker = "/workspace/.eve-synclist";

  await sandbox.run({
    command: `cd /workspace && find ${JSON.stringify(
      rel,
    )} -type f > .eve-synclist 2>/dev/null || true`,
  });

  const listing = sandboxTextOf(
    await sandbox.readTextFile({ path: listMarker }),
  );
  const relativeFiles = listing
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.endsWith(".eve-synclist"));

  const hostWorkspace = hostWorkspaceRoot();
  const copied: string[] = [];
  const skipped: Array<{ path: string; error: string }> = [];

  for (const relFile of relativeFiles) {
    try {
      const hostPath = path.resolve(hostWorkspace, relFile);
      if (!hostPath.startsWith(`${hostWorkspace}${path.sep}`)) {
        throw new Error("path escapes workspace");
      }
      await mkdir(path.dirname(hostPath), { recursive: true });

      if (isBinaryRelativePath(relFile) && sandbox.readBinaryFile) {
        const bytes = sandboxBytesOf(
          await sandbox.readBinaryFile({ path: `/workspace/${relFile}` }),
        );
        await writeFile(hostPath, bytes);
      } else {
        const text = sandboxTextOf(
          await sandbox.readTextFile({ path: `/workspace/${relFile}` }),
        );
        await writeFile(hostPath, text, "utf8");
      }
      copied.push(relFile);
    } catch (error) {
      skipped.push({
        path: relFile,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { runId, hostRunDirectory: hostRunDir(runId), copied, skipped };
}
