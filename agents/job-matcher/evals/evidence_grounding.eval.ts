import { defineEval } from "eve/evals";
import { equals } from "eve/evals/expect";

import type { JobReport, SkillMatch } from "#lib/schemas.js";

import { extractRunId, listSuccessReportFiles, readRunJson, readRunText } from "./lib/run_result.js";

// See spec.md "Evidence grounding" and evals/rubrics.md
// §"evidence_grounding.eval.ts". Single-job run (N=1 direct path) against
// the real resume + a real extractable JD. Every skill marked matched must
// carry evidence that actually appears in the extracted resume text; every
// skill marked not-matched must carry no evidence at all — the no-
// hallucination guarantee, checked against the agent's own written
// resume.txt rather than a hand-maintained copy.

// Docling writes resume.txt as markdown (headings, bold, tables), while the
// model quotes evidence as plain prose — strip markdown formatting chars on
// both sides so a quote of "**Data Governance** lead" still grounds.
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[*_`#|>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export default defineEval({
  description:
    "Every matched skill's evidence is a real quote from the extracted " +
    "resume text; every unmatched skill carries no evidence.",
  async test(t) {
    const turn = await t.send(
      "Analyze my resume at inputs/sk-resume-june-2026.pdf against this job: jobs/anthropic.txt",
    );
    turn.expectOk();
    t.completed();

    const runId = extractRunId(turn.toolCalls);
    const reportFiles = listSuccessReportFiles(runId);
    if (reportFiles.length !== 1) {
      throw new Error(`Expected exactly 1 report file, found ${reportFiles.length}`);
    }
    const report = readRunJson(runId, reportFiles[0]) as JobReport;
    const resumeText = normalize(readRunText(runId, "resume.txt"));

    const allSkills: SkillMatch[] = [
      ...report.analysis.required_skills,
      ...report.analysis.preferred_skills,
    ];

    for (const skill of allSkills) {
      if (skill.matched) {
        if (skill.evidence.trim().length === 0) {
          throw new Error(`Matched skill "${skill.skill}" has empty evidence`);
        }
        const grounded = resumeText.includes(normalize(skill.evidence));
        t.check(grounded, equals(true));
      } else {
        t.check(skill.evidence.trim().length === 0, equals(true));
      }
    }
  },
});
