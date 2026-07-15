# Proposal: job-pilot — daily job qualification and outreach digest

> Status: **PROPOSED** — drafted 2026-07-15. Owner: @senthilsweb.
> Use case: **Job Opportunity Qualification and Outreach.**

## Why

The owner repeats the same loop by hand every day: find new jobs, compare
each against the resume, estimate the match, note missing skills, decide
whether to apply, and prepare outreach. The two building blocks already
exist and are deployed:

- **job-scout** publishes a facts-only parquet snapshot of ~95 company
  job boards every day at 11:00 UTC (`main` = latest; one immutable
  `trends/YYYYMMDD` tag per day). Facts only — no JD text.
- **job-matcher** (deployed as `jobmatch-api.nathansweb.com/analyze` +
  `jobmatch-agent.nathansweb.com/upload`) scores a resume against a JD
  and writes the cover-letter content.

What is missing is the connector: something that wakes up after the daily
snapshot, finds the jobs that are *new since the last run* and match the
owner's target roles, runs the matcher on just those, renders cover-letter
PDFs for the good matches, and sends one digest email. Today that glue is
the owner's time.

## What changes

One new agent, `agents/job-pilot/`, a **LangGraph** (not LangChain-chains)
Python pipeline with four capabilities:

1. **new-jobs-delta** — find jobs new since the last successful run by
   anti-joining two public parquet URLs (today's `main` vs the
   `trends/YYYYMMDD` tag of the last run) with in-memory DuckDB, then
   filter by the owner's target roles from `config.yaml`. Fully
   stateless: no database file anywhere.
2. **match-runner** — for the filtered jobs only, harvest JD text live
   from the ATS APIs, upload it, and call the deployed `POST /analyze`.
   Each job is matched exactly once by construction (only new-since-last-
   run jobs are ever sent). One attempt per job, no retry; failures are
   logged and reported, and the other jobs continue.
3. **email-digest** — one email per run: a table of all new jobs that day
   (title, company, location, salary, matched or not, score, top missing
   skills), cover-letter PDFs attached for jobs at or above the match-band
   threshold, and a failures section. Sent via SMTP/Resend with secrets
   from env only.
4. **ci-orchestration** — a GitHub Actions workflow triggered by the
   completion of `job-scout-trends.yml` (plus manual dispatch), running
   the agent in a Docker image published to GHCR. A paid-run guard caps
   LLM spend per run.

The agent contains **no LLM reasoning of its own** — all model calls
happen inside the deployed job-matcher API. So its evals are plain
code-level tests (pytest), not LLM-judged rubrics.

The wider outreach loop is deliberately phased (see design.md non-goals):
persona outreach messages are v1.5; contact finding and follow-up
tracking are v2 and out of scope here.

## Impact

- New: `agents/job-pilot/` (LangGraph app, tests, Dockerfile, README),
  `.github/workflows/job-pilot.yml`, GHCR image
  `ghcr.io/senthilsweb/job-pilot`, ADR 0003 (LangGraph for Python
  orchestration), `ai-dlc-in-practice/job-pilot/ceremonies-and-roles.md`,
  a job-pilot entry in root `AGENTS.md`.
- Unchanged: `agents/job-scout/` (job-pilot only reads its public parquet
  URLs) and `agents/job-matcher/` (job-pilot only calls the deployed API —
  this also insulates job-pilot from the pending refactor-job-matcher
  change; the API contract is the boundary).
- Privacy: the public repo keeps its facts-only rule. JD text, match
  results, and cover letters exist only on the ephemeral CI runner and
  in the email. Nothing is uploaded as a workflow artifact (artifacts
  on a public repo are world-readable). *Amended at the gate
  (2026-07-15): the resume itself is committed to the public repo at
  the owner's direction — scrubbed of phone/street address.*
