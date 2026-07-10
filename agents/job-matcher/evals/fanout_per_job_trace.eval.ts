import { defineEval } from "eve/evals";
import { equals } from "eve/evals/expect";

import { extractRunId, listSuccessReportFiles, readRunText } from "./lib/run_result.js";

// See design.md "Fan-out / loop policy" and its Correction on trace
// assertions, and evals/rubrics.md §"fanout_per_job_trace.eval.ts". Three
// job sources → three job-analyst delegations, each its own eve child
// session (the practical proxy for "its own trace" — see design.md's
// Telemetry Correction, 2026-07-10). t.event() reads the raw stream for
// subagent.called events and their childSessionId, since that is not
// exposed by a higher-level assertion helper.

interface SubagentCalledEvent {
  type: string;
  data?: { name?: string; childSessionId?: string };
}

export default defineEval({
  description:
    "Three job sources produce three job-analyst subagent delegations, " +
    "each with a distinct childSessionId, plus a correctly ranked ranking.md.",
  async test(t) {
    const turn = await t.send(
      "Analyze my resume at inputs/sk-resume-june-2026.pdf against these jobs: " +
        "jobs/anthropic.txt, jobs/bain.txt, jobs/gusto.txt",
    );
    turn.expectOk();
    t.completed();
    t.calledSubagent("job-analyst");
    t.notCalledTool("analyze_job_fit");
    // t.calledSubagent has no `times` option; exact call count is asserted
    // below via distinct childSessionIds in the raw event stream.

    t.event((events) => {
      const childSessionIds = new Set<string>();
      for (const raw of events) {
        const event = raw as SubagentCalledEvent;
        if (event.type === "subagent.called" && event.data?.name === "job-analyst" && event.data.childSessionId) {
          childSessionIds.add(event.data.childSessionId);
        }
      }
      return childSessionIds.size === 3;
    }, "job-analyst delegated 3 times, each its own distinct childSessionId");

    const runId = extractRunId(turn.toolCalls);
    const reportFiles = listSuccessReportFiles(runId);
    t.check(reportFiles.length, equals(3));

    const ranking = readRunText(runId, "ranking.md");
    const scoreLines = [...ranking.matchAll(/\|\s*(\d+)\/100\s*\|/g)].map((m) => Number(m[1]));
    const sorted = [...scoreLines].sort((a, b) => b - a);
    t.check(scoreLines, equals(sorted));
  },
});
