# Proposal: API match report — sweep, ranked HTML report, daily pipeline

> Status: **APPROVED** (2026-07-13) — owner approved after a live test:
> 85 open postings (Snowflake, Grow Therapy, NVIDIA, Monte Carlo) were
> analyzed through the deployed agent-job-matcher API and rendered as a
> ranked HTML report. This change turns that one-off session work into
> versioned, repeatable tools. Owner: @senthilsweb

## Why

job-scout already finds postings (Tier 1 ATS fetch into DuckDB) and
agent-job-matcher already scores a resume against a job description
(`POST /analyze` on the deployed API). The live test proved the two
connect well, but everything ran from throwaway session scripts:

- The JD harvest, upload, and analyze steps existed only in a scratch
  directory and are already gone.
- Results (85 JSON reports + one HTML report) live in
  `exports/jobmatch-20260713/` but nothing in the repo can regenerate
  or extend them.
- Nothing records which jobs were already analyzed, so a re-run would
  pay for all 85 LLM calls again.

## What changes

Three new capabilities in job-scout, plus one data-model addition:

1. **report-renderer** — `tools/build_match_report.py` renders any
   saved analyze-result JSON file into a ranked, filterable HTML report
   from a Jinja2 template (`templates/match_report.html.j2`). New in
   this version over the session one-off: the full cover letter is
   shown in a collapsible section inside each job row, and failed
   fetches are listed instead of dropped. The existing report at
   `exports/jobmatch-20260713/job-match-report.html` is never touched.
2. **match-sweep** — `tools/match_sweep.py` selects open postings that
   were never analyzed or whose JD text changed, harvests full JD text
   from the ATS APIs, uploads each JD through the agent-service
   `/upload` endpoint, calls the deployed `POST /analyze` in small
   batches with the configured resume, and persists per-job JSON plus
   one row per job in a new `api_match_result` DuckDB table. A
   `--backfill` mode seeds `api_match_result` from an existing result
   file without calling the API (so the 2026-07-13 run is not re-paid).
3. **daily-orchestrator** — `tools/daily_match.py` chains fetch →
   sweep → render in one command for cron/launchd. Email is out of
   scope for v1; the orchestrator has a `--notify` seam that does
   nothing today so a later change can add delivery without touching
   the pipeline.
4. **data-model** — new `api_match_result` table (job_id PK, the five
   scores, match band, run id, JD text hash, timestamps, report path).
   The existing `fit_assessment` table is left unchanged: it belongs to
   the notebook's own deterministic scoring model, not the external
   API's.

`config.yaml` gains a `matcher:` block (API base URLs, resume path,
batch size, export dir) so nothing is hardcoded in the tools.

## Out of scope

- Email/notification delivery (v1 writes files only; the `--notify`
  seam is the extension point).
- Any change to agent-job-matcher itself. Accepting inline JD text on
  `/analyze` (which would remove the upload hop) is logged as a backlog
  item in that repo, not here.
- Re-analysis policy beyond JD-hash change (for example "re-run all
  when the resume changes") — a later change; the hash column supports it.
- Writing API scores into the notebook's ranked board / `v_jobs_ranked`.

## Acceptance criteria

1. `python tools/build_match_report.py --input exports/jobmatch-20260713/all_reports.json --out /tmp/report.html`
   produces a report identical in content to the session report **plus**
   a collapsed cover-letter section per job that expands to the full
   `cover_letter_text`.
2. `python tools/match_sweep.py --backfill exports/jobmatch-20260713/all_reports.json`
   creates 85 rows in `api_match_result` and zero API calls are made.
3. A subsequent `python tools/match_sweep.py` analyzes only postings
   that are new or whose JD hash changed (verified by run log counts),
   and re-running it immediately analyzes zero.
4. `python tools/daily_match.py` runs fetch → sweep → render end to end
   and writes `exports/jobmatch-YYYYMMDD/match-report.html` covering
   **all** analyzed jobs (not only today's), with jobs first analyzed
   today marked "new".
5. The existing `exports/jobmatch-20260713/job-match-report.html` file
   is byte-identical before and after all of the above.
