import { readdirSync, readFileSync } from "node:fs";

import { hostRunDir } from "shared/lib/run.js";

// Small shared helper, copied/adapted from
// agents/privacy-classifier/evals/lib/run_result.ts: after driving a turn,
// pull run_id out of the create_run tool call and read the actual files the
// pipeline wrote to the host run folder — lets evals assert on real output,
// not just the agent's prose reply. Job-matcher's per-job report file names
// are dynamic (slug(<job title>)_<timestamp>.json), so this adds
// listRunFiles for pattern-based discovery on top of privacy-classifier's
// fixed-filename readRunJson.

export interface MinimalToolCall {
  name: string;
  output: unknown;
}

export function extractRunId(toolCalls: readonly MinimalToolCall[]): string {
  const call = toolCalls.find((c) => c.name === "create_run");
  const runId = (call?.output as { run_id?: string } | undefined)?.run_id;
  if (!runId) {
    throw new Error("create_run was not called, or returned no run_id.");
  }
  return runId;
}

export function readRunJson(runId: string, fileName: string): unknown {
  return JSON.parse(readFileSync(`${hostRunDir(runId)}/${fileName}`, "utf8"));
}

export function readRunText(runId: string, fileName: string): string {
  return readFileSync(`${hostRunDir(runId)}/${fileName}`, "utf8");
}

/** List file names directly under the run folder (or a `subdir` inside it). */
export function listRunFiles(runId: string, subdir = ""): string[] {
  const dir = subdir ? `${hostRunDir(runId)}/${subdir}` : hostRunDir(runId);
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Every per-job report JSON at the run root. Excludes: failure records
 * (.failed.json), the run's own metadata (run-meta.json, summary.json), and
 * dot-prefixed scratch files — sync_run_to_host copies EVERYTHING from the
 * sandbox run folder to the host, including extraction scratch like
 * `.extracted-meta.json`, which also ends in .json.
 */
export function listSuccessReportFiles(runId: string): string[] {
  return listRunFiles(runId).filter(
    (name) =>
      name.endsWith(".json") &&
      !name.endsWith(".failed.json") &&
      !name.startsWith(".") &&
      name !== "run-meta.json" &&
      name !== "summary.json",
  );
}

/** Every per-job failure record JSON at the run root. */
export function listFailureReportFiles(runId: string): string[] {
  return listRunFiles(runId).filter((name) => name.endsWith(".failed.json"));
}
