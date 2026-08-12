# Proposal: graceful-match-cap — cap overflow degrades the run, it doesn't deadlock it

> Status: **APPROVED** (2026-08-12, owner-requested in-session). Owner: @senthilsweb.

## Why

job-pilot's daily digest has failed every scheduled run since
2026-08-08 (5 days straight). Each failure is the same `GuardError`:

    N candidates exceed max_jobs_per_run=25 — suspicious delta,
    aborting before any paid call

The guard is doing its job (add-job-pilot's match-runner spec: abort
before any paid call above the cap) — the trigger was a legitimate
job-scout coverage expansion landing 2026-08-08 (Workday full-board
pagination + three new company boards), not a bug. The problem is what
happens next. `.github/workflows/job-pilot.yml` resolves each day's
baseline to "the last **successful** job-pilot run", so once a run
fails, tomorrow's baseline doesn't move, tomorrow's delta is
baseline+2-days instead of +1, and the candidate count stays above the
cap forever. The run-level abort (`raise` in `graph.py`'s `match` node,
by design: "guards must go red, never swallowed") also means
`send_email` never executes — so no digest reaches the owner, even to
report the problem. That's the actual failure mode observed here: 5
silent days, discovered only by manually checking GitHub Actions.

job-matcher itself was never at fault — its `/upload` and `/analyze`
endpoints answer correctly (verified live). It just never gets called,
because job-pilot aborts one node before it.

As job-scout's ATS coverage keeps growing (an ongoing, expanding
target list, not a one-time build), onboarding events like Aug 8's will
recur — a burst of "new" postings on the day a board or a pagination
fix lands, followed by business-as-usual single-digit daily deltas
(verified from 7 days of pre-incident logs: 1–4 candidates/day even at
the current 25-cap headroom). A guard that permanently wedges the
pipeline on burst days is not sustainable at that cadence.

## What changes

**MODIFIED requirement** (was add-job-pilot match-runner "Paid calls
are guarded and capped" — see spec delta below): exceeding
`max_jobs_per_run` no longer raises `GuardError` and aborts the run.
It skips the paid `/analyze` call for that run only (the cost bound is
unchanged — never a paid call above the cap) and records a single
`Failure(node="match_cap", ...)`, which the digest's existing
"Failures" box already renders (`templates/digest.html.j2` — no
template change needed). The run still finishes: `render_pdfs` →
`compose_email` → `send_email`. Two consequences:

1. **The owner is notified the same day**, in the one channel that
   already works (email), instead of a red GitHub Action that goes
   unnoticed.
2. **The baseline always advances on a completed run** (CI's existing
   "last successful run" resolution starts working correctly again the
   moment runs stop hard-failing), so a burst day never compounds into
   a growing backlog the way this incident did. Candidates dropped by
   the cap are not retried — same one-attempt-no-retry policy already
   used for harvest/analyze failures (design.md §Failure handling);
   nothing is silently swallowed, since the email says so.

`RUN_PAID_MATCH != 1` is unchanged — it's a deliberate operator switch,
not a data-driven anomaly signal, and still hard-aborts per the
original design ("guards must go red").

**New operational lever**: `MAX_JOBS_PER_RUN` env var overrides
`config.yaml`'s `matcher.max_jobs_per_run` when set, and
`job-pilot.yml` gains an optional `workflow_dispatch` input for it, so
a deliberate catch-up run (or a temporary bump while a large board
batch is onboarded) doesn't need a code change + image rebuild. The
`config.yaml` default (25) is unchanged: 7 days of pre-incident data
show normal days run 1–4 candidates, so 25 stays a meaningful ceiling
for genuine anomalies (e.g. a bad baseline tag); the graceful-skip
above is what absorbs legitimate burst days without needing to loosen
that ceiling.

## Impact

Touched: `pipeline/matcher.py` (cap check no longer raises; env
override), `tests/test_matcher.py`, `.github/workflows/job-pilot.yml`
(optional dispatch input + env passthrough), `.env.example`,
`docs/configuration.md`. Unchanged: `graph.py` (the `except
matcher.GuardError: raise` path still exists, now reachable only via
`RUN_PAID_MATCH`), `digest.py`/`digest.html.j2` (Failures box already
renders this), CI baseline-resolution script (starts working correctly
again once runs stop hard-failing — no change needed).

## Immediate backlog

This fix does not retroactively recover the 5 days already stuck at
`trends/20260807`. The next run (scheduled or manually dispatched)
will see a multi-day delta, skip matching under the (unchanged) cap,
report it in the digest, and advance the baseline — clearing the
deadlock but not backfilling those specific candidates. A one-off
manual `workflow_dispatch` with a raised `max_jobs_per_run` input is
available afterward if the owner wants those specific jobs matched
rather than skipped.
