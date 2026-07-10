import { defineEval } from "eve/evals";
import { equals, matches } from "eve/evals/expect";

import { JobReportSchema } from "#lib/schemas.js";

import { extractRunId, listSuccessReportFiles, readRunJson, readRunText } from "./lib/run_result.js";

// See evals/rubrics.md §"schema_conformance.eval.ts" and design.md's
// Correction note on report file naming. Drives a real 2-job run (so the
// multi-job path — ranking.md, more than one report file — is exercised;
// it's a superset of what a single-job run would additionally prove about
// schema shape). Requires live model credentials; see tasks.md Bolt 4 for
// the Construction-vs-Verification distinction — this eval is written and
// structurally verified now, live pass is a Verification-phase task.

const FILE_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.json$/;

export default defineEval({
  description:
    "Every per-job report JSON (multi-job run) validates against " +
    "JobReportSchema, and file names match slug(<job title>)_<timestamp>.json.",
  async test(t) {
    const turn = await t.send(
      "Analyze my resume at inputs/sk-resume-june-2026.pdf against these jobs: " +
        "jobs/anthropic.txt, jobs/bain.txt",
    );
    turn.expectOk();
    t.completed();

    const runId = extractRunId(turn.toolCalls);
    const reportFiles = listSuccessReportFiles(runId);
    t.check(reportFiles.length, equals(2));

    for (const fileName of reportFiles) {
      if (!FILE_NAME_PATTERN.test(fileName)) {
        throw new Error(`Report file name "${fileName}" does not match slug(<job title>)_<timestamp>.json`);
      }
      const report = readRunJson(runId, fileName);
      t.check(report, matches(JobReportSchema));
    }

    const ranking = readRunText(runId, "ranking.md");
    t.check(ranking.includes("Job Fit Ranking"), equals(true));
  },
});
