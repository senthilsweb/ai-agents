# Getting Started

Three paths in. Each takes about five minutes. Pick the one that
matches what you want; none of them requires the others.

## Path 1 — See the hiring-trends dashboard (nothing to install)

The public dashboard is rebuilt every day and hosted on this site:

**<https://senthilsweb.github.io/ai-agents/trends/>**

Open it, filter, click a table row for posting details. The **?** icon
at the top right explains every chart in plain words. To track your
own role keywords, add them to the URL —
`…/trends/?roles=ai engineer,engineering manager` — and the page shows
a live tracker for exactly those roles (the public build embeds no
keywords of its own).

To build your own copy from today's live postings, with full job
descriptions embedded (Docker only):

```bash
docker run --rm -v "$PWD/out:/app/exports" ghcr.io/senthilsweb/job-scout trends
open out/hiring-trends-*.html
```

The `trends` job fetches every configured job board (a few minutes),
exports a parquet snapshot, and renders the dashboard into the mounted
`out/` folder.

## Path 2 — Query the public dataset (needs only DuckDB)

At the end you will have live hiring data in a SQL prompt. No download,
no account, no checkout.

```sql
-- in any DuckDB shell (duckdb from Homebrew/pip works)
SELECT category, count(*) AS jobs
FROM 'https://raw.githubusercontent.com/senthilsweb/ai-agents/main/agents/job-scout/data/ats_raw_trends.parquet'
GROUP BY 1 ORDER BY 2 DESC;
```

The file is refreshed every day at 11:00 UTC. Column meanings and more
example queries:
[data/README.md](https://github.com/senthilsweb/ai-agents/blob/main/agents/job-scout/data/README.md).
Prefer a browser? The hosted SQL console at
<https://senthilsweb.github.io/ai-agents/console/> runs DuckDB in your
browser — its default query already reads this dataset.

## Path 3 — Run the notebook locally (full pipeline)

At the end you will have a ranked, scored shortlist of postings in an
interactive notebook, backed by a local DuckDB file.

```bash
cd agents/job-scout
pip install marimo duckdb pyyaml pandas python-dotenv anthropic certifi
marimo edit notebook.py
```

Then, inside the notebook:

1. The database schema is created automatically. Every table starts empty.
2. Click the **"Fetch postings via ATS APIs (Tier 1)"** button. It seeds
   companies from `config.yaml` and pulls live postings that match your
   title keywords.
3. Re-run the **"Ranked board"** cell (or "Run all cells"). It does not
   refresh by itself after a fetch — this is a marimo behavior, see the
   [Runbook](runbook.md#notebook-board-does-not-refresh).
4. Move the scoring sliders (domain fit, compensation, and so on). This
   part is reactive and recomputes instantly.

Your shortlist is the ranked board. CSV and parquet copies land in
`exports/` every time the exports cell runs.

## What next

- Add companies or change role keywords → [Configuration](configuration.md)
- Explore all postings with SQL before filtering → [Data & Queries](data-and-queries.md)
- Score postings against your resume (paid) → [Runbook: the paid match](runbook.md#running-the-paid-match)
