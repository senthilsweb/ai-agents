# job-scout

job-scout is a job-search pipeline. It reads open job postings straight
from ~95 technology companies' own job boards (their public JSON APIs —
no page scraping), stores them in a local [DuckDB](https://duckdb.org)
database, and turns them into three things:

1. **A hiring-trends dashboard** — one self-contained HTML page with
   charts, filters, salary bands, and a job-description side panel.
2. **A public dataset** — a facts-only parquet file, refreshed daily,
   that anyone can query from DuckDB with one URL.
3. **A ranked personal shortlist** — postings scored against a resume
   through a paid matcher API, with a daily HTML report.

Everything deterministic is free and runs anywhere (Docker image,
GitHub Actions, or plain Python). Only the resume matcher costs money,
and it is guarded so it can never run by accident.

## How the pieces fit

```
company job boards (Ashby / Greenhouse / Workday public APIs)
        │
        ▼
ats_posting_raw  ──►  daily export ──► data/ats_raw_trends.parquet (public)
(every posting,                           │
 full JD text)                            ▼
        │                          trends dashboard (HTML)
        ▼  promote (keyword or SQL filter)
job_posting  ──►  match sweep ──► paid matcher API ──► ranked report
(your shortlist)   (only new/changed JDs are ever sent)
```

## Start where you are

| You are… | Start here |
|---|---|
| Just curious about the data | [Getting Started](getting-started.md) — see the dashboard or query the dataset in 5 minutes, nothing to install |
| Setting up the pipeline | [Installation](installation.md), then [Configuration](configuration.md) |
| Writing SQL against the data | [Data & Queries](data-and-queries.md) |
| Building or sharing reports | [Dashboards & Reports](dashboards-and-reports.md) |
| Operating it day to day | [Runbook](runbook.md) |
| Wondering why it works this way | [FAQ](faq.md) |

## Pages

- [Getting Started](getting-started.md) — three 5-minute paths in.
- [Installation](installation.md) — Docker image, docker compose, or local Python.
- [Configuration](configuration.md) — every `config.yaml` section and every environment variable.
- [Data & Queries](data-and-queries.md) — the tables, the public dataset, and a query cookbook.
- [Dashboards & Reports](dashboards-and-reports.md) — building and sharing the HTML pages.
- [Runbook](runbook.md) — daily operations and what to do when something fails.
- [CI/CD](ci-cd.md) — the automated pipelines and how they chain.
- [FAQ](faq.md) — the reasoning, with links to the specs.
- [API match pipeline reference](api-match-pipeline.md) — deep reference for the paid matcher tools.
