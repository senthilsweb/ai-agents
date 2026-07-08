import { readFileSync } from "node:fs";

import { hostRunDir } from "shared/lib/run.js";

// Small shared helper: after driving a turn, pull the run_id out of the
// create_run tool call and read the actual result.json/summary.json the
// pipeline wrote to the host run folder — lets evals assert on real,
// deeply-nested output rather than just the agent's prose reply.

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
