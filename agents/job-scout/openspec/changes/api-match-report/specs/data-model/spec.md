# Spec: data-model (delta)

## ADDED Requirements

### Requirement: External API match results live in `api_match_result`
The schema SHALL gain an `api_match_result` table keyed by `job_id`
(FK to `job_posting`) with: `total_score`, `required_skills_score`,
`preferred_skills_score`, `experience_score`, `domain_score`,
`match_status`, `run_id`, `jd_sha256`, `first_analyzed` (date),
`last_analyzed` (date), `report_json_path`. Rows are upserted on
re-analysis (`first_analyzed` preserved). The existing `fit_assessment`
table SHALL remain unchanged and reserved for the notebook's own
deterministic scoring model — the two scoring models never share a
table.

#### Scenario: Re-analysis after a JD edit
- **WHEN** a posting's JD text hash changes and the sweep re-analyzes it
- **THEN** its row keeps `first_analyzed`, updates the scores, hash,
  `run_id`, `last_analyzed`, and `report_json_path`, and no duplicate
  row is created

#### Scenario: Candidate-data isolation is preserved
- **WHEN** the schema is reused by another candidate
- **THEN** `api_match_result` is recognized as candidate-specific
  (like `fit_assessment` and `referral`) and objective posting facts
  remain untouched in `job_posting`
