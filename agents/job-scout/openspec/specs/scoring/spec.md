# scoring Specification

## Purpose
Transparent, tunable ranking of postings against candidate targets.

## Requirements

### Requirement: Weighted match score
The system SHALL compute
match_score = (w_domain·domain + w_comp·comp + w_hls·hls) · location_factor · visa_factor,
with weights sourced from config.yaml and adjustable at runtime (marimo sliders).

#### Scenario: Weight change re-ranks reactively
- **WHEN** the user moves a weight slider
- **THEN** the ranked view recomputes without re-running ingestion

### Requirement: Compensation normalization
Comp score SHALL be band-midpoint ÷ comp_norm_divisor_usd, capped at 1.0;
missing bands score 0 and MUST be labeled a missing-data artifact, not a fit judgment.

### Requirement: Location weighting
Postings outside preferred locations SHALL be multiplied by
location_penalty_out_of_state (default 0.7); preferred/remote = 1.0.

### Requirement: Visa gate
WHEN visa_gate is true and a posting states no sponsorship, its score SHALL be 0
while the row remains visible for transparency.

#### Scenario: Capital One Software
- **WHEN** a posting explicitly excludes employment-authorization sponsorship
- **THEN** it ranks last with score 0.0 and visa_sponsorship='no' displayed

### Requirement: Staleness gating
Postings SHALL be verified open before insert (verify_before_insert) and
carry last_verified; closed postings are retained with status='closed' as
alert targets, never ranked above open ones.
