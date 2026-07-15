# Spec: cover-letter-template

## ADDED Requirements

### Requirement: PDFs carry the personal letterhead
Every cover-letter PDF SHALL render, in order: the letterhead header
(name in large navy capitals; teal title line; gray contact line; teal
links line; horizontal rule), the letter content, and a signature block
(bold name, teal contact line). All header/signature fields SHALL come
from `templates/letterhead.yaml`; none SHALL be hard-coded in Python.

#### Scenario: Template edit changes every letter
- **WHEN** the owner edits the title line in letterhead.yaml
- **THEN** the next run's PDFs show the new title line with no code change

### Requirement: Letter content comes from the analyze response
The letter body SHALL be the response's `cover_letter_text`. Because
that text already opens with a plain contact line (identity derived
from the resume), that leading line SHALL be stripped — the styled
header replaces it. Date, "Re:" line, salutation, and body SHALL pass
through unchanged. If the text ends at "Sincerely," the signature name
line SHALL be appended; a name the API already appended SHALL not be
duplicated.

#### Scenario: API letter ends at "Sincerely,"
- **WHEN** cover_letter_text ends with "Sincerely,"
- **THEN** the PDF shows "Sincerely," followed by the bold letterhead name and the teal contact line

### Requirement: No score metadata in the letter
The PDF SHALL NOT contain match scores, bands, or any pipeline
metadata — a letter must be forwardable to a recruiter as-is. Scores
stay in the digest email.

### Requirement: Phone stays out of the public repo
The committed letterhead.yaml SHALL NOT contain the phone number; the
`LETTERHEAD_PHONE` env var (GitHub secret in CI) fills it at run time,
and the contact line SHALL skip empty fields cleanly.

#### Scenario: No phone configured
- **WHEN** LETTERHEAD_PHONE is unset
- **THEN** the contact line renders "email · location" with no dangling separator
