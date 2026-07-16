# Tasks — email-recipients-subject

- [x] `render_subject()` + recipient split in `pipeline/digest.py`;
      `build_message` takes the rendered subject
- [x] `email.subject_template` in config.yaml (replaces subject_prefix);
      send node in `pipeline/graph.py` builds the placeholder context
- [x] Tests: multi-recipient To header, subject rendering, typo-safe
      placeholder; 64 passed (2026-07-16)
- [x] Docs: configuration page rows; `.env.example` DIGEST_TO comment
- [x] Commit + push (secret value edit for extra recipients is the
      owner's, whenever wanted)
