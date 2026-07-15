# Spec: new-jobs-delta

## ADDED Requirements

### Requirement: New jobs come from a stateless parquet anti-join
The pipeline SHALL find new jobs by anti-joining the latest public
parquet (`main`) against the `trends/YYYYMMDD` tag of the last
successful run, on `(company_name, req_id)`, using in-memory DuckDB
over HTTPS URLs. No database file SHALL be created or read anywhere.

#### Scenario: Normal day
- **WHEN** the run's baseline is yesterday's tag and 123 postings were added since
- **THEN** exactly those 123 rows enter the pipeline, and rows present in both snapshots are excluded

#### Scenario: Missed a day
- **WHEN** the last successful run was three days ago
- **THEN** the baseline is that day's tag, so the delta automatically covers all three days

### Requirement: Role filter reuses the owner's targets
Candidate jobs SHALL be selected from the delta by `category`
pre-filter, `title_keywords` regex, and the base-salary floor, all read
from job-scout's `config.yaml` `targets:` block — not duplicated. Jobs
with no salary data SHALL pass the salary rule (absence is not a
disqualifier).

#### Scenario: Keyword hit in a filtered category
- **WHEN** a new row is `category='Engineering & Tech'` with title "Senior Engineering Manager, Data Platform"
- **THEN** it becomes a match candidate

#### Scenario: Salary floor
- **WHEN** a new row's `base_max_usd` is 150000 and the configured floor is 220000
- **THEN** it appears in the digest's new-jobs table but is not sent to the matcher
