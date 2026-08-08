# Tasks: add-enterprise-ats-boards

## Bolt 1 — ATS identification (evidence in design.md)
- [x] 1.1 HPE: identify ATS behind Phenom front-end → Workday `hpe/Jobsathpe` (wd5)
- [x] 1.2 AVEVA: identify ATS → Workday `aveva/AVEVA_careers` (wd3)
- [x] 1.3 Cohesity: identify ATS behind AEM proxy → Workday `cohesity/Cohesity_Careers` (wd5)
- [x] 1.4 Quinnox: exhaust ATS options (WP REST, Keka, Zoho Recruit, Greenhouse, Lever) → none; Tier-3 only

## Bolt 2 — Config + docs
- [x] 2.1 config.yaml: add HPE, AVEVA (3-part slug), Cohesity; extend Workday comment; add Quinnox to "Not loadable"
- [x] 2.2 ats_fetch.py: document `tenant/site/host` in module usage + `_infer_platform` docstring
- [x] 2.3 docs/configuration.md: document the 3-part Workday slug form
- [x] 2.4 search-pipeline spec delta (this change's specs/)

## Bolt 3 — Verification
- [x] 3.1 CLI fetch smoke: all three boards return postings with workday_r req ids
- [x] 3.2 raw_load.load() on fresh scratch DB, 3 new companies only (CI trends path) — 20 rows each
- [x] 3.3 fetch_all() on scratch copy of live DB — companies seeded, keyword matches inserted, re-run idempotent
- [x] 3.4 Commit + push to main (image workflow rebuilds on config.yaml; next trends cron picks up companies)

## Bolt 4 — Workday pagination (amendment, owner follow-up 2026-08-07)
- [x] 4.1 fetch_workday: max_postings param (None = first page, 0 = all, N = cap), cross-page dedup on externalPath
- [x] 4.2 Wire through fetch_all (workday_max), raw_load (config read), daily_match (config pass-through), CLI (max=)
- [x] 4.3 config.yaml `workday_max_postings: 0` + docs/configuration.md
- [x] 4.4 Verify: CLI full counts match board totals (HPE ~1073, AVEVA ~246, Cohesity ~209); legacy single-page path unchanged
- [x] 4.5 One-time backfill: fetch_all over full Workday boards into the live job_tracker.duckdb
- [x] 4.6 Deploy: push; dispatch job-scout-trends.yml manually so today's public parquet carries the full boards
