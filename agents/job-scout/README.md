# job-scout

Part of the [senthilsweb/ai-agents](https://github.com/senthilsweb/ai-agents) monorepo
(`agents/job-scout`). Unlike the eve-based siblings, this one is a fully
self-contained Python stack: marimo + DuckDB + YAML config, deterministic-first
with an optional Anthropic agentic layer.

Spec-driven (OpenSpec), deterministic-first job search pipeline in a marimo
notebook backed by DuckDB. Optional agentic search via Anthropic API.

> **Note — Job Data Pre-population:** Web job search scraping is intentionally
> outside the scope of this agent. The `job_tracker.duckdb` database is expected
> to be pre-populated with job postings before running the notebook. A dedicated
> **job-scraper agent** is currently in development and will handle automated
> collection of job postings from company career pages and ATS platforms.

## Run
    pip install marimo duckdb pyyaml pandas python-dotenv anthropic
    marimo edit notebook.py

Place your pre-populated `job_tracker.duckdb` next to `notebook.py` (or let the
notebook create an empty schema — you can then insert postings manually or wait
for the job-scraper agent). Tune everything in `config.yaml`. For agentic
mode: copy `.env.example` to `.env`, add `ANTHROPIC_API_KEY`, set `agentic.enabled: true`.

## Resume context
Convert your resume once, deterministically (no LLM):

    python tools/resume_to_md.py inputs/resume.pdf

The .md output is auto-appended to the agent system prompt as <candidate_resume>.

## Logging
Every run writes a timestamped file to logs/run_YYYYMMDD_HHMMSS.log
(plan counts, skips, exports, agentic calls). Directory and level in config.yaml.

## Layout
    config.yaml            all tunable parameters (search, thresholds, weights)
    .env.example           secrets template (API key only)
    notebook.py            marimo app: schema → sliders → ranked view → exports → search plan → agentic
    openspec/              project.md + specs (data-model, scoring, search-pipeline)
    exports/               generated CSV/Parquet
