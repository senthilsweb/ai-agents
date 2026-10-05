# inputs/

`resumes/` — the owner's four resume DOCX files (master + genai-fde,
data-genai-fde, eng-manager variants). The master is what the matcher
scores; the variants are attached to the digest by job title. Committed
to this public repo at the owner's direction (Inception gate,
2026-07-15), so every file must be the **phone-scrubbed** copy
(`{{PHONE}}` placeholder, no street address).

Never edit them by hand. Sync from the resume-variant folder:

    python tools/sync_resumes.py <resume-variant>/references/master

See `docs/configuration.md` and `openspec/changes/resume-variants/`.
