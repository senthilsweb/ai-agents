# Spec: match-runner

## ADDED Requirements

### Requirement: Only new candidates are matched, once each
The pipeline SHALL send to the matcher API only jobs that are both new
since the baseline and pass the role filter. Because the delta is the
only entry path, no job SHALL be analyzed twice except after a baseline
ambiguity, which is accepted and bounded by the run cap.

#### Scenario: Second run same day
- **WHEN** the pipeline re-runs against the same baseline after a send failure
- **THEN** re-analysis of the same delta is permitted (idempotent by cap), and no job outside the delta is ever sent

### Requirement: JD text is harvested live and stays private
JD text SHALL be fetched from the ATS APIs at match time (Ashby,
Greenhouse, Workday — reusing job-scout's harvest logic), uploaded to
the agent `/upload` endpoint, and held only in memory or the runner's
temp directory. JD text SHALL never be committed, uploaded as a
workflow artifact, or echoed to workflow logs.

#### Scenario: JS-shell posting
- **WHEN** a posting's public page is a JavaScript shell
- **THEN** the JD travels as `.txt` harvested from the ATS JSON/GraphQL API, as job-scout already does

### Requirement: One attempt, no retry, siblings continue
Each job's harvest+analyze SHALL be attempted exactly once. On failure
the pipeline SHALL log the reason, record a failure entry with the job
reference, and continue with the remaining jobs. No retry logic SHALL
exist in v1.

#### Scenario: One board is down
- **WHEN** 6 candidates are matched and one Greenhouse fetch times out
- **THEN** 5 analyses complete, 1 failure entry is recorded, and the digest lists it in the Failures section

### Requirement: Paid calls are guarded and capped
The pipeline SHALL refuse to call `/analyze` unless `RUN_PAID_MATCH=1`,
and SHALL abort before the first paid call if the candidate count
exceeds `MAX_JOBS_PER_RUN` (default 25), logging the count and exiting
non-zero.

#### Scenario: Bad baseline
- **WHEN** a wrong baseline tag makes 300 jobs look new
- **THEN** the run aborts with zero paid calls and a red workflow
