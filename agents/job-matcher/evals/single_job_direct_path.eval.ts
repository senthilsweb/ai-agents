import { defineEval } from "eve/evals";

import { extractRunId, listSuccessReportFiles } from "./lib/run_result.js";

// See spec.md "Fan-out policy and per-job traces" and evals/rubrics.md
// §"single_job_direct_path.eval.ts". Exactly one job source must take the
// direct-call path (analyze_job_fit tool) and never spawn the job-analyst
// subagent — no subagent call at all means the whole run stays one eve
// session, i.e. one trace.

export default defineEval({
  description:
    "A single job source uses the analyze_job_fit tool directly and never " +
    "spawns the job-analyst subagent.",
  async test(t) {
    const turn = await t.send(
      "Analyze my resume at inputs/sk-resume-june-2026.pdf against this job: jobs/anthropic.txt",
    );
    turn.expectOk();
    t.completed();
    t.calledTool("analyze_job_fit", { times: 1 });
    t.notCalledTool("job-analyst");
    // Belt and braces: subagent delegations are derived as their own fact
    // class (t.calledSubagent), so notCalledTool alone may not observe
    // them — assert zero subagent.called events on the raw stream too.
    t.event(
      (events) => !events.some((e) => e.type === "subagent.called"),
      "no subagent delegation of any kind in a single-job run",
    );

    const runId = extractRunId(turn.toolCalls);
    const reportFiles = listSuccessReportFiles(runId);
    if (reportFiles.length !== 1) {
      throw new Error(`Expected exactly 1 report file, found ${reportFiles.length}`);
    }
  },
});
