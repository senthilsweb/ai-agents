# Spec: match-sweep

## ADDED Requirements

### Requirement: Hash-driven selection — never re-pay an unchanged job
`tools/match_sweep.py` SHALL analyze exactly the postings that are
`status='open'` AND have no `api_match_result` row OR whose freshly
harvested JD text hash differs from the stored `jd_sha256`. Running the
sweep twice in a row SHALL make zero `/analyze` calls the second time.

#### Scenario: Idempotent re-run
- **WHEN** a sweep completes and is immediately run again
- **THEN** the second run selects 0 jobs and calls the API 0 times

### Requirement: JD text is harvested from ATS APIs and preserved
For each selected job the sweep SHALL build the JD text from the ATS
JSON APIs (Ashby board API by `req_id`; Workday CXS detail from the
`apply_url`), prefixed with a header naming company, title, location,
compensation when present, and posting URL. The text SHALL be written
under the day's export directory before any API call, and its SHA-256
stored in `api_match_result`. A job whose JD cannot be harvested SHALL
be logged and skipped — never sent empty, never fabricated.

#### Scenario: Posting closed between fetch and sweep
- **WHEN** a selected job no longer appears on its ATS board
- **THEN** the sweep logs it as unharvestable and continues with the rest

### Requirement: Analysis goes through the deployed services only
Each JD SHALL be uploaded via the agent-service `/upload` endpoint and
its returned server-side path passed as a `jobs` field to the deployed
`POST /analyze` together with the configured resume file, in batches of
`matcher.batch_size` (default 3). A failed request SHALL be retried
exactly once; jobs in a batch that still fails are logged and left
unanalyzed for the next run. Per-job response JSON SHALL be written to
disk as soon as its batch returns.

#### Scenario: Transient network error mid-sweep
- **WHEN** one batch request fails with a transport error
- **THEN** it is retried once, and an interrupted sweep resumed later does not re-analyze jobs whose JSON already exists

### Requirement: Backfill seeds history without API calls
`--backfill <path>` SHALL create `api_match_result` rows (and copy
per-job JSONs) from an existing enriched result file, making zero
`/analyze` calls. Hashes come from saved JD files when available.

#### Scenario: Adopting the 2026-07-13 session run
- **WHEN** backfill runs against `exports/jobmatch-20260713/all_reports.json`
- **THEN** 85 rows exist afterwards and the API access log shows no new calls
