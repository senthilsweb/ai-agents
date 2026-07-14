# Getting Started

Three paths in. Each takes about five minutes. Pick the one that
matches what you want; none of them requires the others.

## Path 1 — See the hiring-trends dashboard (needs only Docker)

At the end you will have an interactive HTML dashboard built from
today's live postings.

```bash
docker run --rm -v "$PWD/out:/app/exports" ghcr.io/senthilsweb/job-scout trends
open out/hiring-trends-*.html
```

The `trends` job fetches every configured job board (a few minutes),
exports a parquet snapshot, and renders the dashboard. The `-v` mount
puts the results in an `out/` folder on your machine.

The dashboard is one file with no server behind it — open it, filter,
click a table row to read a job description. The **?** icon at the top
right explains every chart in plain words.

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
Prefer a browser? The repo ships a single-file SQL console:
[utils/duckdb-s3-console.html](https://github.com/senthilsweb/ai-agents/blob/main/utils/duckdb-s3-console.html)
— its default query reads this dataset.

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
