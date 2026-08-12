# Spec: match-runner (delta)

## MODIFIED Requirements

### Requirement: Paid calls are guarded and capped, without deadlocking the pipeline
The pipeline SHALL refuse to call `/analyze` unless `RUN_PAID_MATCH=1`
(unchanged — hard abort, run-level failure, workflow goes red). Exceeding
`max_jobs_per_run` (env `MAX_JOBS_PER_RUN`, else `config.yaml`
`matcher.max_jobs_per_run`) SHALL NOT raise or abort the run: the
pipeline SHALL skip the paid `/analyze` call for that run only, record
exactly one `Failure(node="match_cap", ...)` describing the candidate
count and the cap, and continue through `render_pdfs` →
`compose_email` → `send_email` so the run completes and the digest
email still reaches the owner. Skipped candidates are not retried in a
later run.

#### Scenario: Coverage-expansion burst day
- **WHEN** 40 candidates pass the filter in one run against a cap of 25
- **THEN** zero `/analyze` calls are made, the digest is sent with a
  Failures-box entry naming the count and the cap, and the run exits 0

#### Scenario: Bad baseline
- **WHEN** a wrong baseline tag makes 300 jobs look new
- **THEN** the run still makes zero paid calls and still reports it in
  the digest — visibility no longer depends on the owner checking CI

#### Scenario: Operator disables paid matching
- **WHEN** `RUN_PAID_MATCH` is unset or not `"1"`
- **THEN** the run aborts before any paid call and the workflow goes
  red (unchanged from add-job-pilot)

#### Scenario: One-off catch-up run
- **WHEN** the owner dispatches the workflow with a `max_jobs_per_run`
  input higher than `config.yaml`'s default
- **THEN** the run uses that value as the cap for this run only, with
  no code change or image rebuild required
