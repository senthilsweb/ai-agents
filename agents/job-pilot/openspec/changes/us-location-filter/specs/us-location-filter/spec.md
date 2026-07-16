# Spec: us-location-filter

## ADDED Requirements

### Requirement: Non-US postings never reach a paid call
With `filter.us_only: true` (the default), a job whose location
classifies as a known non-US place, or as an unrecognized string, SHALL
NOT become a match candidate. Jobs classifying as US, and ambiguous
remote/continental values ("Remote", "North America", empty), SHALL
pass — a remote role may be US-eligible, and one analysis costs less
than a missed job.

#### Scenario: Foreign office
- **WHEN** a new posting's location is "London, UK" or "Sydney"
- **THEN** it appears in the digest's new-jobs table but is not analyzed

#### Scenario: Bare remote
- **WHEN** a new posting's location is "Remote"
- **THEN** it remains eligible for analysis

### Requirement: The gate is visible, not silent
Dropped jobs SHALL still appear in the digest's new-jobs table exactly
like other non-candidates, so a misclassified US job can be pursued by
hand. The filter log line SHALL include how many jobs the location gate
removed.

### Requirement: Heuristic is a stopgap
The classification is string-based and layered (US markers → state
codes → state names → hub cities → known non-US → remote-ish). When
job-scout's parquet gains a normalized `country` column, this heuristic
SHALL be replaced by a column check, not extended further.
