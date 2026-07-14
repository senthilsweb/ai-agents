# Spec: public trends data (delta)

## MODIFIED Requirement: Publicly queryable
The current snapshot SHALL be a single canonical file
`data/ats_raw_trends.parquet` on `main` — no `_latest` suffix, no dated
duplicates — readable at a stable GitHub raw URL by a stock DuckDB
client.

#### Scenario: Remote query
- **WHEN** `SELECT count(*) FROM '<raw url>/main/…/data/ats_raw_trends.parquet'` runs in DuckDB
- **THEN** it returns the current snapshot's row count

## MODIFIED Requirement: Daily refresh with tagged history
The GitHub Action SHALL overwrite the canonical file daily and create a
lightweight tag `trends/YYYYMMDD` on the publishing commit (skipped if
the tag already exists). Point-in-time access is via the tag ref, not
via retained files; no prune step exists.

#### Scenario: Time travel by tag
- **WHEN** DuckDB reads `<raw url>/trends/YYYYMMDD/…/data/ats_raw_trends.parquet`
- **THEN** it returns that day's snapshot regardless of later publishes

## Requirement: Facts-only public parquet (unchanged)
`data/` SHALL never contain jd_text, resume data, or match scores.

#### Scenario: Copyright boundary holds
- **WHEN** any file is committed under data/
- **THEN** it contains no JD prose and no personal data
