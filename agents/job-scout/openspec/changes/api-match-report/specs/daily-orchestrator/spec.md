# Spec: daily-orchestrator

## ADDED Requirements

### Requirement: One command chains fetch, sweep, render
`tools/daily_match.py` SHALL run, in order: Tier-1 ATS fetch
(`fetch_all` with config keywords and slugs), the match sweep, and the
report render, writing `exports/jobmatch-YYYYMMDD/match-report.html`.
A step failure SHALL stop the chain with a non-zero exit code and a
logged reason; a run with zero new jobs SHALL still render the report.

#### Scenario: Quiet day
- **WHEN** the daily run finds no new or changed postings
- **THEN** fetch and sweep log zero inserts/analyses and the dated report is still written from existing rows

### Requirement: The daily report is the full ranked picture
The rendered report SHALL include every job present in
`api_match_result` (loaded from each row's persisted JSON), ranked by
total score, with a visible "new" badge on jobs first analyzed on the
run date.

#### Scenario: Two new jobs on day two
- **WHEN** day two's run analyzes 2 new postings
- **THEN** the day-two report shows all previously analyzed jobs plus the 2 new ones badged "new", in one ranking

### Requirement: Notification is a seam, not a feature
The orchestrator SHALL accept `--notify none` (the default) and SHALL
reject any other value with a clear error naming this spec. No email
or messaging code SHALL exist in v1.

#### Scenario: Future email change
- **WHEN** a later change implements `--notify email`
- **THEN** it plugs into the seam without modifying fetch, sweep, or render code

### Requirement: Scheduled-run friendly
The orchestrator SHALL write a timestamped log file per run (reusing
the existing `logging` config), take no interactive input, and rely
only on `config.yaml` + `.env` — so a cron/launchd line can run it
unattended.

#### Scenario: launchd at 07:00
- **WHEN** the job runs unattended and a step fails
- **THEN** the log file contains the failure reason and the exit code is non-zero
