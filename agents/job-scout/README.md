# job-scout

Part of the [senthilsweb/ai-agents](https://github.com/senthilsweb/ai-agents) monorepo
(`agents/job-scout`). Unlike the eve-based siblings, this one is a fully
self-contained Python stack: marimo + DuckDB + YAML config, deterministic-first
with an optional Anthropic agentic layer.

It reads open postings straight from ~95 tech companies' own job boards
(public JSON APIs, no scraping), lands them in DuckDB, and produces a
hiring-trends dashboard, a daily public dataset, and a resume-matched
shortlist. Spec-driven via OpenSpec; every change is proposed, approved,
and built in bolts.

## I want to… → run this

| I want to… | Run this |
|---|---|
| See current hiring trends | `docker run --rm ghcr.io/senthilsweb/job-scout trends` — [Getting Started](docs/getting-started.md) |
| Query the public dataset (no clone, no account) | DuckDB against the raw URL — [data/README.md](data/README.md) has columns + example queries |
| Query a past day's snapshot | swap `main` for a `trends/YYYYMMDD` tag in the same URL — one tag per daily publish; [how to browse tags](data/README.md#browsing-a-snapshot-on-github) |
| Load all job boards into my local DuckDB | `python tools/raw_load.py` — [Data & Queries](docs/data-and-queries.md) |
| Explore postings before filtering | SQL on `ats_posting_raw` — [Data & Queries](docs/data-and-queries.md) |
| Run the interactive notebook (shortlist + scoring) | `marimo edit notebook.py` — [Getting Started](docs/getting-started.md) |
| Run the paid resume-match sweep | `python tools/daily_match.py` — [Runbook](docs/runbook.md#running-the-paid-match) |
| Add companies or role keywords | `config.yaml` — [Configuration](docs/configuration.md) |
| Fix a failing run | [Runbook](docs/runbook.md#failures-and-fixes) |

## Documentation

The wiki lives in [docs/](docs/) and is published at
<https://senthilsweb.github.io/ai-agents/>:

- [Home](docs/index.md) — what job-scout is and how the pieces fit
- [Getting Started](docs/getting-started.md) — three 5-minute paths in
- [Installation](docs/installation.md) — Docker image, compose, or local Python
- [Configuration](docs/configuration.md) — every config section + env var, adding companies safely
- [Data & Queries](docs/data-and-queries.md) — tables, public dataset, query cookbook, sponsors
- [Dashboards & Reports](docs/dashboards-and-reports.md) — building and sharing the HTML pages
- [Runbook](docs/runbook.md) — schedules, the paid-match procedure, failures + fixes
- [CI/CD](docs/ci-cd.md) — the automated pipelines and how they chain
- [FAQ](docs/faq.md) — the reasoning, linked to specs
- [API match pipeline](docs/api-match-pipeline.md) — deep reference for the matcher tools

Two boundaries worth knowing before anything else: the public dataset
is **facts only** (job-description text never leaves local/private
builds), and the paid matcher **cannot run by accident** (structural
guards; dry-run first). Both are explained in the
[FAQ](docs/faq.md).

## Layout

    config.yaml            all tunable parameters (search, thresholds, weights, matcher API)
    .env.example           secrets template — real values go in git-ignored .env
    notebook.py            marimo app: schema → sliders → ranked view → exports → search plan → agentic
    tools/                 CLI tools: ATS fetch, raw load, sponsor load, match sweep, report renderers
    templates/             Jinja2 templates (trends dashboard, match report)
    docs/                  the wiki (this page's Documentation section)
    data/                  public facts-only parquet + its data dictionary
    openspec/              project.md, specs, ADRs, and the changes decision log
    exports/               generated files (git-ignored): parquet snapshots, dashboards, match runs
    Dockerfile, docker-compose.yml, docker/   the container runtime ([Installation](docs/installation.md))
