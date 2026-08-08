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
