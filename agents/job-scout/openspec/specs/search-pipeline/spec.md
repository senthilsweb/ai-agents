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


### Requirement: Three-tier discovery
Discovery SHALL prefer the cheapest reliable method per source:
Tier 1 deterministic ATS APIs (Greenhouse/Lever/Ashby/Workday JSON) for
companies with a configured org slug; Tier 2 search-engine-assisted planning
for unknown ATS; Tier 3 agentic fetch-and-extract only for JS-rendered
sites where Tiers 1-2 cannot produce structured postings.

Tier 1 SHALL be runnable from config alone: before fetching, it SHALL
idempotently seed a company row (name + inferred ats_platform) for every entry
in search.ats_org_slugs_by_company, so a configured slug is sufficient to
produce postings on an empty database. Title filtering SHALL use forgiving
token overlap (seniority/stop words dropped), not full-phrase substring, and
fetched compensation SHALL be persisted so it participates in scoring.

#### Scenario: Ashby company
- **WHEN** a company has an Ashby slug configured but no company row yet exists
- **THEN** Tier 1 seeds the company row from config, then fetches postings via
  the posting API with UUIDs intact and no LLM call

#### Scenario: Phenom-rendered career site
- **WHEN** direct fetch returns an empty JS template
- **THEN** the posting is routed to the agentic tier for verification and extraction

### Requirement: Sponsor ingestion, review-gated by default
Conference sponsor lists SHALL be ingested via an idempotent loader that
accepts any CSV path. For RainFocus-hosted conferences the live API fetch
(tools/fetch_sponsors_rainfocus.py) is the primary source; a hand-curated CSV
remains a documented fallback for non-RainFocus conferences (the repo ships no
example seed file). Discovery MAY auto-classify using deterministic
keyword/tier heuristics and, for non-critical sourcing, MAY chain fetch ->
classify -> load in one step (--load) without human review. Auto-classification
is best-effort; false positives are acceptable for this use case and rows
falling outside known heuristics are marked 'unclassified' rather than
guessed.

#### Scenario: Re-run of the same seed
- **WHEN** the loader runs twice with the same CSV
- **THEN** zero duplicate companies or sponsorships are created

#### Scenario: Low-stakes one-shot ingestion
- **WHEN** --load is passed to the RainFocus fetcher
- **THEN** the review CSV is written, classified, and loaded in the same run
  with no human approval step

### Requirement: RainFocus catalog fetch
For RainFocus-hosted conferences, the full exhibitor catalog SHALL be fetched
deterministically via the events API (per-event rfapiprofileid supplied at
runtime, never committed) and emitted as a seed CSV with empty classification
columns; loading remains gated on human review and the idempotent loader.

#### Scenario: DAIS full catalog
- **WHEN** the fetch runs with a valid profile id
- **THEN** all exhibitors land in a review CSV with tier extracted where present
  and raw JSON retained for provenance
