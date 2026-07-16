# Spec: email-digest (delta)

## MODIFIED Requirements

### Requirement: One digest email per run, always
Every successful run SHALL send exactly one email. The body SHALL list
**only match candidates**: each analyzed job as a card (title linking
to the apply URL, company · location · salary, total score, a
four-segment score bar of the component scores, a band pill in the
match-report band colors, top missing skills, and the recommendation),
and candidate jobs that failed as a Failures section. Jobs that did not
pass the filter SHALL NOT be listed; the full delta appears only as a
one-line summary of counters (postings scanned, outside-US, matched
filter, analyzed, letters attached). A run with zero candidates SHALL
still send a short quiet-day email carrying the same counters, so a
silent day always means the pipeline is broken.

#### Scenario: Three candidates out of 123 new postings
- **WHEN** 123 new postings yield 3 candidates, all analyzed
- **THEN** the email shows exactly 3 cards plus the counter line; the other 120 jobs appear only in the counts

#### Scenario: Quiet day
- **WHEN** the delta is empty or nothing passes the filter
- **THEN** a short email is sent stating how many postings were scanned and that none matched

### Requirement: Cards are self-ranking
Cards SHALL be ordered by total score, highest first.
