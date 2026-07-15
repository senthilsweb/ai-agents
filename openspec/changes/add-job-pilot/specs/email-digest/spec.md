# Spec: email-digest

## ADDED Requirements

### Requirement: One digest email per run, always
Every successful run SHALL send exactly one email with three sections:
**New jobs today** (every delta row, matched or not: title, company,
location, salary, score + match band and top missing skills where
analyzed), **Matched — letters attached**, and **Failures**. A run with
zero new jobs SHALL still send a short quiet-day email, so a silent day
always means the pipeline is broken.

#### Scenario: Quiet day
- **WHEN** the delta is empty
- **THEN** a short "no new matching jobs" email is sent and the workflow is green

### Requirement: Cover letters ship as PDF attachments
For each match at or above the configured band threshold, the
cover-letter text from the analyze result SHALL be rendered through one
Jinja2 template to a PDF named `slug(company-title).pdf` and attached.
Below-threshold matches appear in the table without an attachment.

#### Scenario: Two good matches out of five
- **WHEN** five jobs are analyzed and two reach `good_match`
- **THEN** the email lists all five and carries exactly two PDFs

### Requirement: Rendering is injection-safe
All job-derived text (titles, company names, missing skills, letter
text) SHALL render through Jinja2 with autoescape enabled in the email
HTML. The PDF SHALL be drawn as literal text (fpdf2 — no markup
interpretation; amended 2026-07-15, Construction Correction 1).

#### Scenario: Hostile title
- **WHEN** a posting title contains `<script>` or HTML
- **THEN** it renders as literal text in the email and PDF

### Requirement: Delivery uses env secrets only
Gmail SMTP credentials (app password) and addresses SHALL come from environment
variables (`.env` locally, GitHub secrets in CI) — never from
`config.yaml`, the image, or the repo. A send failure SHALL exit
non-zero.
