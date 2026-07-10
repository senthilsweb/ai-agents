// ── File-naming helper ──────────────────────────────────────────────────
//
// See openspec/changes/add-job-matcher/design.md "Final output" and
// specs/job-matcher-agent/spec.md. One JSON per job link, named
// `slug(<job title>)_<timestamp>.json`, so a run folder is scannable at a
// glance without opening every file.

const MAX_SLUG_LENGTH = 60;

/**
 * Lowercase, ASCII, hyphen-separated slug. Strips anything that is not a
 * letter or digit (unicode letters normalize through NFKD first, so
 * accented characters degrade to their ASCII base rather than vanishing),
 * collapses runs of separators to one hyphen, trims leading/trailing
 * hyphens, and caps length so file names stay readable in a directory
 * listing.
 */
export function slugify(input: string): string {
  const normalized = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // combining diacritical marks
    .toLowerCase();
  const slug = normalized
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const capped = slug.slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, "");
  return capped.length > 0 ? capped : "job";
}

/** `slug(<job title>)_<timestamp>.json`, e.g. `senior-data-engineer-acme_2026-07-09T14-22-31Z.json`. */
export function reportFileName(jobTitle: string, timestamp: string): string {
  return `${slugify(jobTitle)}_${timestamp}.json`;
}
