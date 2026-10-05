# Spec delta: role-filter — Jev decides the fuzzy rules

## ADDED Requirements

### Requirement: Jev mode is explicit and defaults to off

`JEV_MODE` SHALL be one of `off`, `shadow`, `enforce`. With the value unset,
or `TYPESAFE_API_KEY` unset, the mode SHALL be `off` and the pipeline SHALL
behave exactly as it did before this change.

#### Scenario: No key
- **WHEN** `TYPESAFE_API_KEY` is empty and `JEV_MODE=enforce`
- **THEN** the mode is `off` and a warning is logged

### Requirement: Shadow mode changes nothing

In `shadow` mode Jev SHALL be called for the same jobs as `enforce` would,
and its answers SHALL be recorded and compared with the current rules, but no
candidate, variant or attachment SHALL differ from `off`.

### Requirement: Enforce mode falls back to the existing rule

In `enforce` mode a Jev answer SHALL decide a job's location, role fit or
variant only when its `confidence` meets the configured threshold. On a
low-confidence answer, a timeout, an HTTP error, or an unparseable response,
the existing rule SHALL decide that job, a Failure SHALL be recorded, and the
email SHALL still be sent.

### Requirement: Only public job facts leave the process

A Jev request SHALL contain only whitelisted `JobFact` fields (title,
department, employment type, location, work mode, compensation summary) and
the configured question text. It SHALL NOT contain resume text, cover-letter
text, or candidate identity.

### Requirement: Rejections are visible

For each job the gate rejects, the run SHALL record the question, the answer
and the confidence. The digest SHALL show rejection counts by reason and the
near-misses (rejected with confidence below the threshold plus the configured
margin).

## MODIFIED Requirements

### Requirement: Role filter reuses the owner's targets

Deterministic rules (category set, salary floor) SHALL run first and are
unchanged. Location and title-fit decisions SHALL be made by Jev in `enforce`
mode and by the existing string heuristics otherwise. The target roles SHALL
still come from job-scout's `targets`, not be duplicated.
