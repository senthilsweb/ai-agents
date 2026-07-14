# Design: trends-dashboard

## D1 — Renderer is a Jinja tool, like the match report
`tools/build_trends_report.py` + `templates/trends_dashboard.html.j2`.
The template wraps all static CSS/JS in `{% raw %}` blocks; data enters
through four small Jinja islands (`data_json`, `keywords_json`,
`jd_json`, `jd_mode`). Rows are embedded as compact arrays-of-arrays;
every chart and filter computes client-side, so the page stays a single
self-contained file (artifact CSP allows no external requests).

## D2 — JD embedding is a build-time budget decision
All 5,421 JDs ≈ 21 MB of text — too heavy to publish. `--jd` modes:
- `target` (default): embed JD only for rows matching config
  `title_keywords` (the only JDs the owner reads) ≈ +3–4 MB.
- `all`: everything, for local files.
- `none`: lean page, drawer shows metadata + apply link only.
JD text comes from the sibling full parquet (`--jd-from`, default
inferred by replacing `trends` with `full` in the input name), joined on
(company_name, req_id) — req_id added to the trends export for this.
The drawer renders JD via textContent (no HTML injection).

## D3 — Copyright boundary
Facts (title, company, location, salary band, dates, URLs, category)
are not copyrightable → publishable in `data/`. JD prose is the hiring
company's copyrighted text → never committed, never in `data/`, only
embedded in the owner's private dashboard file for personal job-search
use (fair-use posture; sharing the artifact publicly is the owner's
call, flagged in README). Source APIs are the boards' own public JSON
endpoints; no scraping.

## D4 — Public data layout
`agents/job-scout/data/` (NOT gitignored, unlike exports/):
- `ats_raw_trends_YYYYMMDD.parquet` — daily immutable snapshots,
  pruned after 90 days (≈ 34 MB steady state at ~376 KB/day).
- `ats_raw_trends_latest.parquet` — stable URL for dashboards/DuckDB.
Consumers: `duckdb -c "SELECT ... FROM 'https://raw.githubusercontent.com/
senthilsweb/ai-agents/main/agents/job-scout/data/ats_raw_trends_latest.parquet'"`.
Retained dated files double as the time-series the snapshot table
itself cannot provide (loads replace rows in place).

## D5 — Daily refresh via GitHub Action
Root workflow `.github/workflows/job-scout-trends.yml`: cron 11:00 UTC
(~07:00 ET) + workflow_dispatch; ubuntu-latest; pip install duckdb
pyyaml certifi; `raw_load.py` then `raw_load.py --export`; copy to
data/; prune by filename date (checkout mtimes are useless); commit with
github-actions bot via default GITHUB_TOKEN (permissions:
contents: write; concurrency group prevents overlap). CI has no
job_tracker.duckdb — raw_load creates a fresh one — so export()'s
company join degrades gracefully when the company table is absent.

## D6 — Explorer UX
Client-side pagination (25/50/100, default 25) replaces the 150-row cap.
Row click opens the drawer unless the click hit the apply link; ESC and
a close button dismiss it; a header toggle disables row-click entirely.
Target-role panel, filters, and sorting behave as in v1.
