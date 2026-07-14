# Proposal: trends-dashboard

**Status:** APPROVED 2026-07-14 (owner approved in session; "Yes, go ahead")

## Why

The raw ATS snapshot (`ats_posting_raw`, 5,400+ postings) proved useful as
an interactive hiring-trends dashboard, but the first version was a
one-off scratch script: not reproducible, no way to read a posting's JD
without leaving the page, a hard 150-row table cap, and the underlying
data was local-only. The owner wants the dashboard re-buildable from any
dated parquet, the trends data publicly consumable (GitHub raw URL,
queryable straight from DuckDB), and the whole thing refreshed daily
without a laptop.

## What changes

1. **Renderer becomes a repo tool** — `tools/build_trends_report.py` +
   `templates/trends_dashboard.html.j2` (same pattern as
   build_match_report): `--input <trends.parquet> --out <html>`.
2. **Dashboard upgrades** — method/normalization notes on the page,
   paginated explorer table, click-a-row JD drawer (right sliding panel;
   full-screen on mobile), a top toggle to enable/disable the drawer,
   and build-time `--jd target|all|none` controlling how much JD text is
   embedded.
3. **Public data** — `data/ats_raw_trends_YYYYMMDD.parquet` +
   `data/ats_raw_trends_latest.parquet` committed to the repo
   (facts only, never jd_text). DuckDB can query the raw GitHub URL
   directly.
4. **Daily refresh** — GitHub Action (schedule + manual dispatch) runs
   raw load → export → commits the dated + latest parquet, pruning dated
   files older than 90 days.

## Out of scope

- Publishing JD text anywhere public (copyright boundary — see design D3).
- Publishing the full parquet or any matcher/resume data.
- Historical backfill of trend snapshots before 2026-07-14.
- LLM analysis of the trends data (owner runs that ad hoc).

## Acceptance criteria

1. `python tools/build_trends_report.py --input exports/ats_raw_trends_<stamp>.parquet --out <html>`
   reproduces the dashboard with pagination, drawer, and method notes.
2. `--jd target` (default) embeds JD text only for config-keyword rows;
   `--jd none` embeds none; `--jd all` embeds everything (local use).
3. `SELECT count(*) FROM '<github raw url>/data/ats_raw_trends_latest.parquet'`
   works from a stock DuckDB shell.
4. The workflow commits a fresh parquet daily without any repo secrets
   beyond the default GITHUB_TOKEN.
5. Nothing under `data/` contains JD text, resume data, or match scores.
