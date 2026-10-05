# Tasks — resume-variants

- [x] `pipeline/resumes.py`: `find`, `choose_variant`, `render` (phone
      injection), `docx_text` (tables included), `scoring_resume`,
      `render_attachments`
- [x] `tools/sync_resumes.py`: copy the four DOCX files, scrub the phone,
      refuse leftovers, keep exactly one file per variant
- [x] `config.yaml`: `resumes` block (dir, fallback, ordered rules);
      drop `matcher.resume_path`
- [x] `graph.py`: scoring resume from the master; `attach_resumes` node
      after `render_pdfs`; failures reported in the digest, never fatal
- [x] `digest.py` + template: DOCX attached with its real MIME type; card
      shows the variant; header counts resumes; `{resumes}` subject placeholder
- [x] `inputs/resumes/` populated from the 2026-10-04 master; `inputs/resume.md` removed
- [x] `tests/test_resumes.py` (+ graph tests): rules, injection, table
      extraction, band filter and dedupe, sync scrub, public-repo phone guard
- [x] Docs: configuration, FAQ, runbook, README, inputs/README, root AGENTS.md
- [x] Full test suite green
- [x] Commit + push (rebuilds `ghcr.io/senthilsweb/job-pilot:latest`) — CI green, ed4c443
- [x] Live run 2026-10-05 (dispatch vs `trends/20261001`): 13 analyzed, 0 failures,
      10 letters + 3 resumes (eng-manager, genai-fde, master) in one email
- [ ] Owner confirms: next digest with a `good_match`+ job carries the letter
      and the expected resume variant (Verification)
