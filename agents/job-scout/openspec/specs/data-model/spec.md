# data-model Specification

## Purpose
Generic, multi-company job tracking schema extensible to public companies,
funded startups, conferences/sponsors, contacts, and referrals.

## Requirements

### Requirement: Generic req ID storage
The system SHALL store ATS requisition identifiers as free text with a
companion `req_id_type` (ashby_uuid | workday_r | greenhouse_id | phenom_hash
| friendly) so any ATS format is supported without schema change.

#### Scenario: Workday vs Ashby
- **WHEN** an NVIDIA posting (JR2017180) and a Snowflake posting (ae2d6f1c-…) are inserted
- **THEN** both persist without transformation and the type column disambiguates them

### Requirement: Company funding attributes
The company entity SHALL carry nullable funding fields (latest_round,
latest_round_usd, total_raised_usd) populated only for private companies.

#### Scenario: Public company
- **WHEN** a public company (e.g., NVIDIA) is inserted
- **THEN** funding fields remain NULL and no constraint fails

### Requirement: Candidate-specific data isolation
Fit assessment (scores, bars, relevance flags) SHALL live in a separate table
from objective posting facts.

#### Scenario: Sharing the model
- **WHEN** the schema is reused by another candidate
- **THEN** only fit_assessment and referral contain candidate-specific rows

### Requirement: Conference sourcing
The system SHALL model conferences and company sponsorships (tier, source)
as a many-to-many relationship for sponsor-driven job sourcing.

#### Scenario: DAIS 2026 ingestion
- **WHEN** a sponsor list is ingested for a conference
- **THEN** each company links to the conference with tier and verification source

### Requirement: Contacts are user-supplied
Contact email/phone SHALL be populated only from user-provided data; the
pipeline SHALL NOT scrape personal contact details.

#### Scenario: Referral logging
- **WHEN** the user names a referrer for a job
- **THEN** a referral row links contact→job with status lifecycle
  (identified → requested → submitted)
