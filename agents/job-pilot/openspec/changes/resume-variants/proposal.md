# Proposal: resume-variants — score the current master, attach the right variant

> Status: **IMPLEMENTED** (2026-10-04, owner-requested in-session). Owner: @senthilsweb.

## Why

The digest's cover letters were generated from `inputs/resume.md`, a
hand-copied markdown file from the Inception gate (2026-07-15). The owner
keeps the real resumes in the private resume-variant skill (a master plus
three role variants) and revised them several times since — the Pentaho
end date, the Io-Tahoe/Rokittech dates, the AZ-Tech entry, and on
2026-10-04 the master's current role and the Rokittech dates again. The
copy here went stale each time, so letters and scores described a
resume that no longer existed, and the email carried no resume at all.

## What changes

- **One source of truth.** `inputs/resumes/` holds the four DOCX files
  (`master`, `genai-fde`, `data-genai-fde`, `eng-manager`), synced by
  `tools/sync_resumes.py` from the owner's resume-variant folder.
  `inputs/resume.md` is removed.
- **Scoring reads the master.** `pipeline/resumes.py` extracts the master's
  text from the DOCX itself, tables included. job-matcher's own DOCX
  reader skips tables (404 of ~1,650 words in the master — competencies,
  tooling, earlier experience), so handing it the DOCX would silently
  drop a quarter of the resume.
- **Email carries the relevant variant.** For every match at or above
  `matcher.pdf_band_threshold` (the cover-letter cut), the variant is
  chosen by ordered title rules in `config.yaml` (first match wins; no
  match falls back to master). Each distinct variant is attached once,
  and the digest card names it.
- **Public-repo safety.** The repo is public and the resumes carry a
  phone number. The sync tool replaces it with `{{PHONE}}` and refuses
  to write a file with anything phone-shaped left in any part; at attach
  time the number is injected from the existing `LETTERHEAD_PHONE`
  secret. A test fails the build if a number reaches a committed resume.

## Out of scope

- **PDF attachments.** The slim image has no DOCX→PDF converter
  (see docs/faq.md); DOCX is also the editable form for applying.
- **JD-aware variant choice.** Rules read the job title only; job text is
  never retained (match-runner spec), so there is nothing else to read.
- **Cover-letter letterhead text** (`templates/letterhead.yaml`) is unchanged.

## Verification

Owner confirms the next digest with a `good_match`-or-better job carries
the cover letter and the expected resume variant, with a phone number.
