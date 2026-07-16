# Spec: email-delivery (delta)

## ADDED Requirements

### Requirement: Comma-separated recipients
`DIGEST_TO` SHALL accept one or more addresses separated by commas.
Whitespace around addresses SHALL be trimmed and empty entries ignored.
All listed addresses SHALL receive the digest via one message with a
multi-address `To:` header.

#### Scenario: Two recipients
- **WHEN** DIGEST_TO is "me@x.com, spouse@y.com"
- **THEN** both addresses appear in the To: header and both receive the email

### Requirement: Templated subject line
The subject SHALL render from `email.subject_template` in config.yaml
with placeholders `{date}` (dd-mmm-yyyy), `{new}`, `{candidates}`,
`{matched}`, `{strong}`, `{pdfs}`. Default:
`[job-pilot] {matched} matches ({strong} strong) · {new} new · {date}`.
An unknown placeholder SHALL render as empty text with a logged
warning — a template typo must never block the send.

#### Scenario: Counts-first triage
- **WHEN** a run analyzes 3 jobs (2 strong) out of 123 new on 16 Jul 2026
- **THEN** the subject reads "[job-pilot] 3 matches (2 strong) · 123 new · 16-Jul-2026"

#### Scenario: Typo in the template
- **WHEN** the template contains "{matchez}"
- **THEN** the email still sends, with the bad placeholder rendered empty and a warning logged
