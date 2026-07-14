# Design: api-match-report

## Context

The 2026-07-13 live test proved the shape of the pipeline. This design
records the decisions made there and the ones taken with the owner
before implementation.

## Decisions

### D1 — Renderer lives in job-scout, template-driven
The renderer is a pure function of `(report, metadata)` pairs, so it
could live in either repo. Owner picked job-scout `tools/` (fastest
path, sits beside the data). It may graduate to agent-job-matcher later
as the official renderer of its response model — the input contract
(D2) is written so that move costs nothing.

HTML/CSS live in `templates/match_report.html.j2` (Jinja2), not in
Python strings. Jinja2 is chosen over the `{{placeholder}}`-only style
agent-job-matcher uses for cover letters because this page loops over
jobs; plain placeholder substitution cannot loop.

### D2 — Input contract: enriched entries, raw API array accepted
The input JSON is a list. Each element is either:

- **Enriched** (what match-sweep writes): job-scout metadata fields
  (`job_id`, `company`, `title`, `location`, `apply_url`, `file`,
  optionally `first_analyzed`) plus `report` — one `JobReport` or
  `JobFetchFailure` object exactly as the API returned it; or
- **Raw**: a bare `JobReport`/`JobFetchFailure` object (the direct
  `/analyze` response shape). The renderer then falls back to
  `analysis.job_title` for the title, shows no apply link, and groups
  under company "(unknown)" when the model extracted none.

This keeps the renderer reusable by any consumer of the API, not only
job-scout. Discrimination is by the presence of a `report` key.

### D3 — JD travels via agent-service `/upload`
Ashby/Workday posting pages are JavaScript shells; the API's URL
fetcher correctly rejects them (word-count guard). The deployed
agent-service shares an `uploads` volume with the API container, so:
harvest JD text from the ATS JSON APIs → `POST /upload` (a `.txt`
file) → pass the returned server path as a `jobs` form field to
`/analyze`. This is a coupling to the docker-compose volume layout;
the decoupled fix (inline `job_text` on `/analyze`) is agent-job-matcher
backlog, deliberately not blocking this change.

### D4 — Selection is hash-driven, harvest happens at sweep time
A job is analyzed when it is `status='open'` AND (no `api_match_result`
row OR `jd_sha256` differs from the stored one). The hash is computed
over the harvested JD text (header + body). Closed postings vanish from
ATS boards (4 of the original 89 were already gone), so the sweep also
persists each harvested JD text file under the day's export dir —
the text that produced a score is never lost.

### D5 — `api_match_result` is a new table
`fit_assessment` (existing, empty) is shaped for the notebook's own
scoring model (domain fit, HLS, location booleans) and stays reserved
for it. The external API's deterministic 100-point result gets its own
table keyed by `job_id`, upserted on re-analysis, carrying `jd_sha256`
for change detection and `report_json_path` for traceability.

### D6 — Batches of 3, one retry, per-job JSON immediately
`/analyze` fans out internally (`JOB_FANOUT_CONCURRENCY`, default 3),
so the sweep sends 3 jobs per request. A failed request is retried
once, then its jobs are logged and skipped (the API itself never
retries a fetch — same philosophy here: one honest retry for transport
errors only). Each job's JSON is written as soon as its batch returns,
so an interrupted sweep resumes without re-paying finished jobs.

### D7 — Daily report renders the full table, not the day's delta
The daily orchestrator regenerates the report from **all** rows'
persisted JSON (paths in `api_match_result`), so the report is always
the complete ranked picture. Jobs first analyzed today get a "new"
badge. Rationale: a ranked shortlist is only useful in full; a
delta-only page cannot be ranked meaningfully.

### D8 — Email deferred behind a no-op seam
`daily_match.py --notify <mode>` accepts only `none` in v1 and exits
with an error for anything else. A later change implements a real mode
without touching fetch/sweep/render.

## Alternatives considered

- **Store scores in `fit_assessment`** — rejected; mixes two scoring
  models in one table and the columns do not fit.
- **Render client-side from JSON** — rejected; static generation keeps
  the report a single self-contained file that opens anywhere.
- **Analyze via local repo/CLI instead of deployed API** — rejected;
  the owner's goal is exercising the deployed service end to end.

## Risks

- **Ashby/Workday API shape drift** — harvest fails loudly per job and
  the sweep continues; a job with no harvestable JD is logged, not
  fabricated.
- **Shared-volume coupling (D3)** — if the deployment splits the
  containers, uploads stop resolving; the sweep surfaces this as
  `JobFetchFailure` reasons mentioning the path, and the fix is the
  backlogged inline-text API field.
- **Score churn** — gpt-5.4-mini extraction varies slightly between
  runs; scores are only recomputed when the JD hash changes, so ranks
  stay stable day to day.
