# Runbook

At the end you will know what runs by itself, how to check it, and what
to do when something fails.

## What runs automatically

| When | What | Output |
|---|---|---|
| Daily, after the 11:00 UTC trends publish | `job-pilot daily digest` workflow | one email to `DIGEST_TO` |
| Every push touching `agents/job-pilot/` | `job-pilot tests and image` workflow | pytest + GHCR image on main |

## The one daily check

**Did the email arrive?** A quiet day still sends a short "no new
matching jobs" email. **No email means the pipeline is broken** — open
the repo's Actions tab and look at the latest "job-pilot daily digest"
run.

## Procedures with cost

- **Manual run**: Actions → "job-pilot daily digest" → Run workflow.
  Optional input: a baseline tag like `trends/20260710` to widen the
  window. Guard: the run aborts before any paid call above
  `max_jobs_per_run` (25), so the worst-case bill is bounded.
- **Local paid run**: set `RUN_PAID_MATCH=1` in `.env`, then
  `python run.py --dry-run --baseline trends/YYYYMMDD`. Same guard.

## Failures seen so far

| Symptom | Cause | Fix |
|---|---|---|
| Digest lists a job under "Failures" with "JD too short" | the job board serves a JavaScript shell; the ATS API had no text either | nothing to fix — the job is reported, not scored; apply manually if interesting |
| Run aborts with "candidates exceed max_jobs_per_run" | wrong/old baseline made too many jobs look new | re-run with an explicit recent `--baseline`; the guard already prevented any cost |
| Arize spans silently missing; exporter logs "Internal Server Error" | Arize requires a `model_id` resource attribute on every span | already fixed in `pipeline/telemetry.py` (2026-07-15) — keep `model_id` if you touch tracing |
| `RUN_PAID_MATCH != 1 — refusing paid /analyze calls` | the paid-call switch is off | set `RUN_PAID_MATCH=1` only when you intend to pay |

## Telemetry

Every run is one LangSmith trace (project `job-pilot`) and one OTel
trace fanned out to OpenObserve and Arize. Missing telemetry
configuration degrades to a logged warning — it never blocks the email.

Next: [CI/CD](ci-cd.md)
