# search-pipeline Specification

## Purpose
Deterministic search-plan generation with optional agentic execution.

## Requirements

### Requirement: Config-driven query generation
The system SHALL generate search queries purely from config templates ×
target keywords × companies with pipeline_status in (not_started, alert_target).

#### Scenario: No LLM available
- **WHEN** agentic mode is disabled
- **THEN** the notebook still emits the full ordered query plan for manual execution

### Requirement: Deterministic-first agentic execution
WHEN agentic mode is enabled, the model SHALL execute only the generated
queries (bounded by max_searches_per_run), verify postings are open, and
return rows conforming to the job_posting schema; fabricating req IDs or
salaries is prohibited — unknown fields are null with a note.

### Requirement: Pipeline status tracking
Every company SHALL carry pipeline_status
(not_started | jobs_found | alert_target | excluded_visa) so coverage of a
sponsor list (e.g., DAIS 2026's 240+) is auditable at any point.

### Requirement: Crawl-ledger idempotency
Every executed query SHALL be recorded in crawl_log keyed by a normalized
query hash. On re-runs, queries with a ledger entry newer than
recrawl_ttl_days SHALL be skipped; expired entries re-crawl.

#### Scenario: Same-day re-run
- **WHEN** the pipeline runs twice within the TTL window
- **THEN** the second run emits zero duplicate queries and reports the skip count

### Requirement: Versioned prompts and skills
Agent prompts SHALL live as files under prompts_dir (system.md + task
prompts) and reusable procedures under skills_dir, versioned alongside
openspec; config.yaml holds only paths, never prompt bodies. The candidate
resume SHALL be appended to the system prompt as matching context when present.
