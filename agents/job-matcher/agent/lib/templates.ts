// ── Cover-letter text rendering (content only — no document generation) ───
//
// See openspec/changes/add-job-matcher/design.md "Final output" and
// specs/job-matcher-agent/spec.md "Templates staged under inputs". Pure
// string logic; assemble_report.ts owns reading the template file from the
// sandbox (agent/sandbox/workspace/inputs/templates/) and calls in here.

export interface CoverLetterContext {
  jobTitle: string;
  companyName?: string;
  generatedAt: string;
}

/** Render mustache-style `{{variable}}` placeholders. Unknown keys pass through literally. */
export function renderTemplate(template: string, data: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(data, key) ? data[key] : match,
  );
}

/**
 * Format cover-letter paragraphs as plain text. When `templateText` is
 * provided (loaded from inputs/templates/cover_letter.txt), renders through
 * it with `{{paragraphs}}`, `{{job_title}}`, `{{company_name}}`, and
 * `{{date}}` placeholders. When absent — the default, expected case in v1 —
 * degrades to the paragraphs joined by a blank line, never failing the run.
 */
export function formatCoverLetter(
  paragraphs: string[],
  context: CoverLetterContext,
  templateText?: string,
): string {
  const joined = paragraphs.join("\n\n");
  if (!templateText) return joined;
  return renderTemplate(templateText, {
    paragraphs: joined,
    job_title: context.jobTitle,
    company_name: context.companyName ?? "",
    date: context.generatedAt,
  });
}
