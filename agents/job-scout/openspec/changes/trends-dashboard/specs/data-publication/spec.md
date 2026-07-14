# Spec: public trends data

## Requirement: Facts-only public parquet
`data/` SHALL contain only fact columns (company, platform, req ids,
title, department, team, employment type, location, work mode, comp
summary string, parsed USD band, posted date, apply URL, fetch time,
category). It SHALL NEVER contain jd_text, resume data, or match scores.

#### Scenario: Copyright boundary holds
- **WHEN** any file is committed under data/
- **THEN** it contains no JD prose and no personal data

## Requirement: Publicly queryable
The latest snapshot SHALL be readable at a stable GitHub raw URL by a
stock DuckDB client.

#### Scenario: Remote query
- **WHEN** `SELECT count(*) FROM '<raw url>/ats_raw_trends_latest.parquet'` runs in DuckDB
- **THEN** it returns the current snapshot's row count

## Requirement: Daily refresh
A GitHub Action SHALL regenerate and commit the snapshot daily (cron +
manual dispatch), writing a dated file plus latest, pruning dated files
older than 90 days, using only the default GITHUB_TOKEN.

#### Scenario: Unattended day
- **WHEN** the scheduled run completes on a day with board changes
- **THEN** data/ gains/updates parquet files via a bot commit and no other paths change
