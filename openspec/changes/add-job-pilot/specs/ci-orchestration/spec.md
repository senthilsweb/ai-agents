# Spec: ci-orchestration

## ADDED Requirements

### Requirement: Triggered by the trends publish, runnable by hand
`.github/workflows/job-pilot.yml` SHALL run on `workflow_run`
completion of `job-scout-trends.yml` (success only) and on
`workflow_dispatch`. This guarantees the day's parquet is on `main`
before the pipeline reads it.

#### Scenario: Trends run fails
- **WHEN** the 11:00 UTC trends workflow fails
- **THEN** job-pilot does not run that day (no stale-delta email)

### Requirement: Baseline from workflow history, not a ledger
The workflow SHALL resolve the baseline tag by querying the GitHub API
for its own last successful run date and mapping it to
`trends/YYYYMMDD`. On the first run ever, or if the tag is missing, the
pipeline SHALL fall back to the previous day's tag and rely on the run
cap.

#### Scenario: First run
- **WHEN** job-pilot has no successful run history
- **THEN** the baseline is yesterday's tag and `MAX_JOBS_PER_RUN` bounds the cost

### Requirement: Runs in the published Docker image
The pipeline SHALL run inside `ghcr.io/senthilsweb/job-pilot`
(python:3.12-slim + WeasyPrint deps), rebuilt and pushed by the
workflow when `agents/job-pilot/` changes. Local runs use the same
image or a plain `python run.py` with `.env`.

### Requirement: Nothing private leaves the runner
The workflow SHALL upload no artifacts. Job logs SHALL contain facts
and error reasons only — never JD text, letter content, or match JSON.
The resume is read from the repo checkout
(`agents/job-pilot/inputs/resume.md` — owner's gate decision to keep it
public); match results and cover letters SHALL exist only on the
runner and in the sent email.

#### Scenario: Debugging a failed run
- **WHEN** a maintainer opens the public workflow log
- **THEN** they see counts, job references, and error reasons, and no protected content

### Requirement: Tests run in CI on every push
The pytest suite (evals 1–6, design.md §Evals) SHALL run as a separate
workflow job on every push touching `agents/job-pilot/`, with no
secrets and no network beyond fixture files.
