import { z } from "zod";

// ── Job-matcher schemas ──────────────────────────────────────────────────
//
// See openspec/changes/add-job-matcher/design.md and evals/rubrics.md.
//
// JobAnalysisSchema is the ONLY schema an LLM call ever fills in (the
// orchestrator's direct call, or the job-analyst subagent). It carries
// counts and evidence, never a score — ScoreBreakdownSchema is filled in
// exclusively by the deterministic scoring.ts, never by a model. This split
// is a security property (see design.md "Untrusted input & prompt
// injection"), not just an architecture preference: there is no field an
// injected instruction could set to alter the score, because no such field
// exists in this schema.

export const SkillMatchSchema = z
  .object({
    skill: z.string().min(1),
    matched: z.boolean(),
    evidence: z
      .string()
      .describe(
        "A quote drawn from the extracted resume text proving the match. " +
          "Empty when matched is false.",
      ),
  })
  .refine(
    (s) => (s.matched ? s.evidence.trim().length > 0 : s.evidence.trim().length === 0),
    {
      message:
        "evidence must be non-empty when matched is true, and empty when matched is false",
    },
  );
export type SkillMatch = z.infer<typeof SkillMatchSchema>;

export const ExperienceAlignmentSchema = z.enum(["exact", "close", "partial", "far"]);
export type ExperienceAlignment = z.infer<typeof ExperienceAlignmentSchema>;

export const DomainAlignmentSchema = z.enum(["exact", "related", "transferable", "none"]);
export type DomainAlignment = z.infer<typeof DomainAlignmentSchema>;

/** The one and only LLM-filled schema — counts and evidence, never a score. */
export const JobAnalysisSchema = z.object({
  job_title: z.string().min(1),
  company_name: z.string().optional(),
  required_skills: z.array(SkillMatchSchema),
  preferred_skills: z.array(SkillMatchSchema),
  experience_alignment: ExperienceAlignmentSchema,
  experience_years_context: z
    .string()
    .describe('Short free-text grounding, e.g. "resume shows 9 years; JD asks for 8-10".'),
  domain_alignment: DomainAlignmentSchema,
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
  resume_improvements: z.array(z.string()),
  ats_keywords_missing: z.array(z.string()),
  cover_letter_angle: z.string(),
  cover_letter_paragraphs: z
    .array(z.string())
    .describe("Text content only — v1 does not render a document. See design.md non-goals."),
  summary: z.string(),
});
export type JobAnalysis = z.infer<typeof JobAnalysisSchema>;

/** Filled in exclusively by agent/lib/scoring.ts — never by a model call. */
export const ScoreBreakdownSchema = z.object({
  required_skills_score: z.number().int().min(0).max(40),
  preferred_skills_score: z.number().int().min(0).max(20),
  experience_score: z.number().int().min(0).max(20),
  domain_score: z.number().int().min(0).max(20),
  total_score: z.number().int().min(0).max(100),
});
export type ScoreBreakdown = z.infer<typeof ScoreBreakdownSchema>;

export const MatchStatusSchema = z.enum([
  "strong_match",
  "good_match",
  "moderate_match",
  "weak_match",
  "no_match",
]);
export type MatchStatus = z.infer<typeof MatchStatusSchema>;

/** One job link that could not be read — logged, not analyzed, never retried. */
export const JobFetchFailureSchema = z.object({
  run_id: z.string(),
  generated_at: z.string(),
  job_source: z.string(),
  fetch_status: z.literal("failed"),
  reason: z.string(),
  attempted_at: z.string(),
});
export type JobFetchFailure = z.infer<typeof JobFetchFailureSchema>;

/**
 * One job link that was fetched, analyzed, and scored. This is the
 * self-contained report written to
 * `slug(<job title>)_<timestamp>.json` (design.md "Final output").
 */
export const JobReportSchema = z.object({
  run_id: z.string(),
  generated_at: z.string(),
  job_source: z.string(),
  fetch_status: z.literal("ok"),
  resume_file: z.string(),
  models: z.record(z.string(), z.string()),
  analysis: JobAnalysisSchema,
  score_breakdown: ScoreBreakdownSchema,
  match_status: MatchStatusSchema,
  recommendation: z.string(),
});
export type JobReport = z.infer<typeof JobReportSchema>;

/** The shape of any one file under runs/<ts>/ — either an analysis or a logged failure. */
export const JobOutcomeSchema = z.union([JobReportSchema, JobFetchFailureSchema]);
export type JobOutcome = z.infer<typeof JobOutcomeSchema>;
