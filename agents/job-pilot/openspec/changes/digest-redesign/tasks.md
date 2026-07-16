# Tasks — digest-redesign

- [x] `MatchResult` + `to_match`: carry the four component scores
- [x] `templates/digest.html.j2`: card layout, match-report palette,
      inline CSS, counter summary line, quiet-day variant
- [x] `pipeline/digest.py` compose: candidates-only cards, counters
      (incl. outside-US count via `location_bucket`)
- [x] Tests updated (cards not rows, counters, hostile title still
      escaped); 61 passed (2026-07-16)
- [x] README line describing the email updated
- [x] Local preview rendered with today's three real jobs →
      ~/Desktop/job-pilot-digest-preview.html, opened for the owner
- [ ] Owner confirms the next live digest looks right (Verification)
