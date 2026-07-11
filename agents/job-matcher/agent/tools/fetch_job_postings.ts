import { defineTool } from "eve/tools";
import { z } from "zod";

import { writeRunArtifact } from "shared/lib/run.js";

import { mapWithConcurrency } from "#lib/concurrency.ts";

// ── Deterministic, bounded-concurrency job-posting fetch (no LLM) ─────────
//
// See openspec/changes/add-job-matcher/design.md and specs/job-matcher-
// agent/spec.md ("Job fetch guards", "Graceful link failure — log, stop,
// no retry").
//
// One tool call fetches every job source in the run — not one call per
// link left to the orchestrator's judgment. That makes "exactly one
// attempt per source" and the concurrency bound (JOB_FANOUT_CONCURRENCY)
// both real code-level guarantees (mapWithConcurrency) rather than prompt
// instructions the model could deviate from. A source is either an
// http(s) URL or a bare filename staged under agent/sandbox/workspace/
// inputs/ (a local JD file, for offline/eval use — same path-confinement
// contract as load_input, never a host path).
//
// Correction (2026-07-09, Construction/Bolt 2): design.md originally
// sketched `fetch_job_posting` (singular, one call per job left to the
// orchestrator). Batching into one deterministic, code-controlled call is
// a Construction-time refinement — it does not change any approved
// requirement's substance (spec.md's "exactly one attempt per job source"
// holds either way), and it is the only way to make that guarantee code-
// enforced rather than instruction-enforced. Logged here per this repo's
// convention (AI-SDLC-TAILORING.md).

const INPUTS_ROOT = "/workspace/inputs";
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 5_000_000;
const DEFAULT_MIN_WORDS = 100;

// SSRF mitigation: block obvious internal/link-local targets before ever
// opening a connection. This is a documented, deliberately partial
// defense — it does not resolve DNS and check the resolved IP (no
// protection against DNS rebinding), which is flagged as a residual risk
// in design.md's Security baseline section rather than silently assumed
// away.
const BLOCKED_HOSTNAMES = new Set(["localhost", "0.0.0.0", "127.0.0.1", "::1", "169.254.169.254"]);
const PRIVATE_IPV4_PREFIXES = [/^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^169\.254\./];

function isBlockedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(lower)) return true;
  return PRIVATE_IPV4_PREFIXES.some((re) => re.test(lower));
}

function stripHtml(html: string): string {
  return html
    .replace(/<(script|style|nav|footer|header|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

interface FetchOk {
  job_source: string;
  fetch_status: "ok";
  text: string;
  word_count: number;
}
interface FetchFailed {
  job_source: string;
  fetch_status: "failed";
  reason: string;
}
type FetchOutcome = FetchOk | FetchFailed;

async function fetchOne(
  source: string,
  ctx: { getSandbox: () => Promise<{ readTextFile(opts: { path: string }): PromiseLike<unknown> }> },
  minWords: number,
  maxBytes: number,
): Promise<FetchOutcome> {
  const isUrl = /^https?:\/\//i.test(source);

  if (!isUrl) {
    // Local JD file, staged under inputs/ — same confinement rule as
    // load_input: bare filename or relative path, no leading '/', no '..'.
    // Tolerates one leading "inputs/" segment (the documented prompt
    // convention phrases paths as inputs/<file>).
    if (source.startsWith("/") || source.split("/").includes("..")) {
      return { job_source: source, fetch_status: "failed", reason: "invalid local path" };
    }
    const localPath = source.replace(/^inputs\//, "");
    try {
      const sandbox = await ctx.getSandbox();
      const raw = await sandbox.readTextFile({ path: `${INPUTS_ROOT}/${localPath}` });
      const text = typeof raw === "string" ? raw : String((raw as { content?: unknown })?.content ?? "");
      if (Buffer.byteLength(text, "utf8") > maxBytes) {
        return { job_source: source, fetch_status: "failed", reason: `local file exceeds the ${maxBytes}-byte cap` };
      }
      const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
      if (wordCount < minWords) {
        return {
          job_source: source,
          fetch_status: "failed",
          reason: `local file has ${wordCount} words, below the ${minWords}-word minimum`,
        };
      }
      return { job_source: source, fetch_status: "ok", text, word_count: wordCount };
    } catch (error) {
      return {
        job_source: source,
        fetch_status: "failed",
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return { job_source: source, fetch_status: "failed", reason: "malformed URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { job_source: source, fetch_status: "failed", reason: `disallowed scheme: ${url.protocol}` };
  }
  if (isBlockedHost(url.hostname)) {
    return { job_source: source, fetch_status: "failed", reason: `disallowed host: ${url.hostname}` };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        redirect: "follow",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      return { job_source: source, fetch_status: "failed", reason: `HTTP ${response.status}` };
    }
    // Re-check the post-redirect scheme/host — fetch() only ever connects
    // over http/https itself, but a redirect could still land on a
    // blocked internal hostname.
    const finalUrl = new URL(response.url || source);
    if (isBlockedHost(finalUrl.hostname)) {
      return { job_source: source, fetch_status: "failed", reason: `redirected to disallowed host: ${finalUrl.hostname}` };
    }

    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (contentLength > maxBytes) {
      return { job_source: source, fetch_status: "failed", reason: `response too large: ${contentLength} bytes` };
    }
    const raw = await response.text();
    if (Buffer.byteLength(raw, "utf8") > maxBytes) {
      return { job_source: source, fetch_status: "failed", reason: "response exceeded size cap" };
    }

    const text = stripHtml(raw);
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    if (wordCount < minWords) {
      return {
        job_source: source,
        fetch_status: "failed",
        reason: `page yielded ${wordCount} extractable words (below the ${minWords}-word minimum) — likely JavaScript-rendered or login-walled`,
      };
    }
    return { job_source: source, fetch_status: "ok", text, word_count: wordCount };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { job_source: source, fetch_status: "failed", reason: message };
  }
}

export default defineTool({
  description:
    "Fetch every job source in one call — http(s) URLs or local filenames " +
    "staged under inputs/. Exactly one attempt per source, bounded " +
    "concurrency, no retries. A source that fails (bad scheme, blocked " +
    "host, non-2xx, too large, or below the minimum-extractable-words " +
    "guard) is recorded as failed with a reason and does not block the " +
    "others. Writes jobs/<index>.txt per successful fetch and jobs/fetch-" +
    "attempts.json logging exactly one attempt per source.",
  inputSchema: z.object({
    run_dir: z
      .string()
      .min(1)
      .describe("The run directory, e.g. runs/2026-07-05T14-26-27Z"),
    job_sources: z
      .array(z.string().min(1))
      .min(1)
      .describe("Each entry: an http(s) URL, or a filename staged under inputs/."),
    concurrency: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Max parallel fetches; defaults to JOB_FANOUT_CONCURRENCY or 3."),
  }),
  async execute({ run_dir, job_sources, concurrency }, ctx) {
    const runId = run_dir.replace(/^runs\//, "").replace(/\/+$/, "");
    if (!runId || runId.includes("..") || runId.includes("/")) {
      throw new Error(`Invalid run_dir: ${run_dir}`);
    }

    const limit = concurrency ?? Number(process.env.JOB_FANOUT_CONCURRENCY ?? "3");
    const maxBytes = Number(process.env.JOB_FETCH_MAX_BYTES ?? DEFAULT_MAX_BYTES);
    const minWords = Number(process.env.JOB_FETCH_MIN_WORDS ?? DEFAULT_MIN_WORDS);

    const attemptedAt = new Date().toISOString();
    const outcomes = await mapWithConcurrency(job_sources, limit, (source) =>
      fetchOne(source, ctx, minWords, maxBytes),
    );

    const attempts = outcomes.map((o) => ({
      job_source: o.job_source,
      attempts: 1,
      fetch_status: o.fetch_status,
      attempted_at: attemptedAt,
    }));
    await writeRunArtifact(
      ctx,
      runId,
      "jobs/fetch-attempts.json",
      JSON.stringify({ attempts }, null, 2) + "\n",
    );

    const results = await Promise.all(
      outcomes.map(async (outcome, index) => {
        if (outcome.fetch_status === "ok") {
          const written = await writeRunArtifact(ctx, runId, `jobs/${index}.txt`, outcome.text);
          return {
            job_index: index,
            job_source: outcome.job_source,
            fetch_status: "ok" as const,
            job_text_path: `jobs/${index}.txt`,
            host_job_text_path: written.hostPath,
            word_count: outcome.word_count,
          };
        }
        return {
          job_index: index,
          job_source: outcome.job_source,
          fetch_status: "failed" as const,
          reason: outcome.reason,
        };
      }),
    );

    return {
      total: results.length,
      ok_count: results.filter((r) => r.fetch_status === "ok").length,
      failed_count: results.filter((r) => r.fetch_status === "failed").length,
      results,
    };
  },
});
