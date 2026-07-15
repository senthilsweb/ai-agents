# Tasks — templated-cover-letter

- [x] `templates/letterhead.yaml` (no phone; colors + fields from the
      CMI June 2026 letter)
- [x] `pipeline/letters.py`: letterhead header, contact-line strip,
      signature completion, drop the score meta line;
      `LETTERHEAD_PHONE` env pickup; body left-aligned (template is
      not justified)
- [x] Tests: strip/signature goldens, no-phone contact line,
      no-score-metadata check, render smoke; full suite green
      (42 passed, 2026-07-15)
- [x] Docs: README letterhead note, `.env.example` entry
- [x] Sample rendered 2026-07-15 from the real Snowflake analyze
      result and visually compared against the CMI letter — header,
      rule, date/Re/salutation, signature block all match
- [ ] Owner eyeballs the rendered PDF (Verification):
      scratchpad/snowflake-engineering-manager-bedrock.pdf
