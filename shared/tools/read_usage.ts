import { defineTool } from "eve/tools";
import { z } from "zod";

import { readAllUsage, readUsage, sumUsage } from "shared/lib/usage.js";

// See openspec/adr/0001-shared-agent-runtime-kit.md §5.

export default defineTool({
  description:
    "Read accumulated token usage (inputTokens, outputTokens, cacheReadTokens, " +
    "cacheWriteTokens, steps) captured by the usage hook for the current run, " +
    "including every subagent session. Returns a per-session map plus run-level " +
    "totals and current_session_id. Pass session_id to read a single session.",
  inputSchema: z.object({
    session_id: z
      .string()
      .optional()
      .describe("Optional session id; omit to read all sessions in the run."),
  }),
  async execute({ session_id }, ctx) {
    const current_session_id = ctx.session.id;

    if (session_id) {
      const record = readUsage(session_id);
      return {
        current_session_id,
        sessions: record ? { [session_id]: record } : {},
        totals: sumUsage(record ? [record] : []),
      };
    }

    const records = readAllUsage();
    const sessions: Record<string, unknown> = {};
    for (const record of records) sessions[record.sessionId] = record;
    return { current_session_id, sessions, totals: sumUsage(records) };
  },
});
