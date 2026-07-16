# Proposal: digest-redesign — candidates only, match-report card style

> Status: **APPROVED** (2026-07-16, owner feedback on the first live
> digest). Owner: @senthilsweb.

## Why

The first production digest worked but read badly: a 123-row table of
every new posting (the original spec said "every delta row, matched or
not"), plain styling, and the three jobs that actually mattered were
buried at the top. The owner's verdict: show **only the jobs that
passed the filter**, and format them like the job-scout match report he
already likes (`templates/match_report.html.j2` — score, segmented
score bar, colored band pill, Apply link).

## What changes

1. **MODIFIED requirement** (was add-job-pilot email-digest "One digest
   email per run, always"): the email body lists ONLY match candidates
   — analyzed jobs as cards, failed candidates in the Failures section.
   Full-delta visibility moves to one summary line of counters
   (scanned / outside-US / matched filter / analyzed / letters
   attached). Quiet-day email and send-always behavior unchanged.
2. **Card layout** ported from the match-report design tokens: big
   score, four-segment score bar (required/preferred/experience/domain
   points), band pill in the report's band colors, Apply link, top
   missing skills, recommendation line. Inline CSS only (Gmail strips
   little, but inline is the safe floor); light palette from the
   report's `:root`.
3. **`MatchResult` carries the score breakdown** (the four component
   scores from the analyze response) so the bar can render — previously
   only the total survived `to_match`.

## Impact

Touched: `templates/digest.html.j2` (rewrite), `pipeline/digest.py`
(compose), `pipeline/state.py` + `pipeline/matcher.py` (score
breakdown fields), tests, README/docs lines describing the email.
Unchanged: send path, PDFs, filter, graph, CI.
