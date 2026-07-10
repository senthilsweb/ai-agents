import { defineEval } from "eve/evals";
import { equals } from "eve/evals/expect";

import {
  extractRunId,
  listFailureReportFiles,
  listSuccessReportFiles,
  readRunJson,
} from "./lib/run_result.js";

// See spec.md "Graceful link failure — log, stop, no retry" and
// evals/rubrics.md §"jd_fetch_guards.eval.ts". Fixtures are the two real
// captures from 2026-07-09 (evals/data/jobs/failures/*), staged at
// agent/sandbox/workspace/inputs/jobs/{adp-fail,ashby-fail}.txt as their
// already-extracted, too-short text (17 and 8 words) — genuine failures of
// the minimum-extractable-words guard, not synthetic ones. Mixed with one
// real extractable job so the eval also proves a failure never aborts the
// rest of the run.

interface FetchAttempt {
  job_source: string;
  attempts: number;
  fetch_status: "ok" | "failed";
}

export default defineEval({
  description:
    "Two genuinely too-short JD fixtures fail the min-words guard with " +
    "exactly one logged attempt each and no retry, while a third, real " +
    "job in the same run completes normally.",
  async test(t) {
    const turn = await t.send(
      "Analyze my resume at inputs/sk-resume-june-2026.pdf against these jobs: " +
        "jobs/adp-fail.txt, jobs/ashby-fail.txt, jobs/anthropic.txt",
    );
    turn.expectOk();
    t.completed();
    t.calledTool("fetch_job_postings", { times: 1 });

    const runId = extractRunId(turn.toolCalls);

    const attemptsLog = readRunJson(runId, "jobs/fetch-attempts.json") as {
      attempts: FetchAttempt[];
    };
    t.check(attemptsLog.attempts.length, equals(3));
    for (const attempt of attemptsLog.attempts) {
      t.check(attempt.attempts, equals(1));
    }
    const failedSources = attemptsLog.attempts.filter((a) => a.fetch_status === "failed");
    t.check(failedSources.length, equals(2));

    const reportFiles = listSuccessReportFiles(runId);
    t.check(reportFiles.length, equals(1));

    const failureFiles = listFailureReportFiles(runId);
    t.check(failureFiles.length, equals(2));
    for (const fileName of failureFiles) {
      const failure = readRunJson(runId, fileName) as { fetch_status: string; reason: string };
      t.check(failure.fetch_status, equals("failed"));
      t.check(typeof failure.reason === "string" && failure.reason.length > 0, equals(true));
    }
  },
});
