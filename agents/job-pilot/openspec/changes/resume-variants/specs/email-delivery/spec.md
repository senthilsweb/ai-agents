# Spec delta: email-delivery — resume variants

## ADDED Requirements

### Requirement: Matched jobs carry the relevant resume variant

For each match at or above `matcher.pdf_band_threshold`, the digest email
SHALL attach the resume variant selected by the first `resumes.rules`
entry whose `title_contains` matches the job title (case-insensitive
substring), or `resumes.fallback` when none does. Each distinct variant
SHALL be attached at most once, as a DOCX, and the job's digest card SHALL
name the variant.

#### Scenario: Engineering manager role
- **WHEN** a `good_match` job is titled "Senior Engineering Manager"
- **THEN** the email attaches the eng-manager variant and the card says so

#### Scenario: No rule matches
- **WHEN** a `good_match` job is titled "Product Manager"
- **THEN** the master resume is attached

#### Scenario: Below the cut
- **WHEN** a match is below `pdf_band_threshold`
- **THEN** no resume is attached for it

### Requirement: A resume problem never blocks the digest

A missing or ambiguous variant file SHALL be recorded as a Failure
(`node: resumes`) in the digest, and the email SHALL still be sent.

### Requirement: No phone number in the repository

Committed resume files SHALL contain `{{PHONE}}` instead of a phone number
in every part. The number SHALL be injected from `LETTERHEAD_PHONE` only
when an attachment is rendered. `tools/sync_resumes.py` SHALL refuse to
write a file with anything phone-shaped left, and a test SHALL fail the
build if one is committed.

## MODIFIED Requirements

### Requirement: Scoring resume

The matcher SHALL score the text of the master DOCX in `inputs/resumes/`,
extracted including table content. `inputs/resume.md` no longer exists.
