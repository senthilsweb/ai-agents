# Proposal: templated-cover-letter — letterhead header/footer on PDFs

> Status: **APPROVED** (2026-07-15, owner-requested). Owner: @senthilsweb.

## Why

Bolt 3 shipped a minimal cover-letter PDF: plain title, a match-score
meta line, and the letter text. The owner's real cover letters follow a
personal letterhead (see `sk-cover-letter-cmi-june-2026.pdf`): name in
large navy capitals, a teal title line, a gray contact line, a teal
links line, a horizontal rule — then date, "Re:" line, salutation,
body, and a signature block (bold name + teal contact line). The
attached PDFs should be send-ready in that format, not an internal
artifact with score metadata on it.

The owner suggested python-docx with a .docx template as one option.
Rejected for the same reason WeasyPrint was (add-job-pilot
Correction 1): the output must be PDF, and headless DOCX→PDF conversion
requires LibreOffice or Word on the runner — a heavyweight system
dependency for a one-page letter. The template idea is kept; the
template is data, not a document: `templates/letterhead.yaml` holds the
layout fields and colors, and fpdf2 renders it.

## What changes

1. `templates/letterhead.yaml` — the letterhead template: name, title
   line, contact fields, links, signature links, colors. **The phone
   number is NOT committed** (public repo); it is injected at run time
   via the `LETTERHEAD_PHONE` env var / CI secret, and the contact line
   simply skips empty fields.
2. `pipeline/letters.py` — renders the letterhead header (name / title /
   contact / links / rule) and a styled signature block. The body comes
   from the analyze response's `cover_letter_text`, which already
   carries a plain contact line, date, Re: line, salutation and
   "Sincerely," — the leading plain contact line is stripped (the
   styled header replaces it), and the signature is completed with the
   bold name + teal contact line if the API text ends at "Sincerely,".
   The Bolt-3 match-score meta line is dropped from the PDF — scores
   live in the digest email, not in a letter a recruiter might read.
3. Tests updated: strip/signature logic golden tests + render smoke.

## Impact

- Touched: `pipeline/letters.py`, `templates/letterhead.yaml` (new),
  `tests/test_letters.py`, README (one line), `.env.example`
  (`LETTERHEAD_PHONE`).
- Unchanged: digest email, matcher, graph, CI. PDF filenames and the
  band threshold behave exactly as before.
