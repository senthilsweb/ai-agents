import { defineTool } from "eve/tools";
import { z } from "zod";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { modelIdFor, MODEL_ORCHESTRATOR } from "#lib/model.js";

const USAGE_DIR = join(tmpdir(), "eve-usage");

export default defineTool({
  description:
    "Read accumulated token usage (inputTokens, outputTokens, cacheReadTokens, " +
    "cacheWriteTokens, steps) captured by the usage hook for the current session " +
    "and any child subagent sessions. Call this after each phase and again before " +
    "invoking the reporter, so token data can be written into phase traces. " +
    "Returns a map of sessionId → usage, plus current_session_id so you can " +
    "identify your own usage. If session_id is given, returns only that " +
    "session's usage.",
  inputSchema: z.object({
    session_id: z
      .string()
      .optional()
      .describe(
        "Optional: a specific session id to read usage for. " +
        "If omitted, returns usage for ALL sessions in the current run.",
      ),
  }),
  async execute({ session_id }, ctx) {
    const current_session_id = ctx.session.id;
    if (!existsSync(USAGE_DIR)) {
      return { sessions: {}, current_session_id, note: "No usage data captured yet." };
    }

    if (session_id) {
      const p = join(USAGE_DIR, `${session_id}.json`);
      if (!existsSync(p)) {
        return { sessions: {}, current_session_id, note: `No usage found for session ${session_id}.` };
      }
      const data = JSON.parse(readFileSync(p, "utf8"));
      return { sessions: { [session_id]: data }, current_session_id };
    }

    // Read all usage files (skip run-<sessionId>.json mapping files)
    const files = readdirSync(USAGE_DIR)
      .filter((f) => f.endsWith(".json") && !f.startsWith("run-"));
    const sessions: Record<string, unknown> = {};
    for (const f of files) {
      try {
        const data = JSON.parse(readFileSync(join(USAGE_DIR, f), "utf8"));
        sessions[data.sessionId ?? f.replace(".json", "")] = data;
      } catch {
        // skip malformed files
      }
    }
    return { sessions, current_session_id };
  },
});
