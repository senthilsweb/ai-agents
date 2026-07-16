# job-pilot

One email a day about new jobs that fit you.

Every morning, [job-scout](../job-scout/) publishes a public parquet
snapshot of open jobs at ~95 tech companies. job-pilot wakes up after
that publish, finds the jobs that are **new since its last run** and
match your target roles, sends only those to the deployed
[job-matcher](../job-matcher/) API for scoring and a cover letter, and
emails you one digest: the matching jobs as ranked score cards (with
top missing skills and a recommendation), cover-letter PDFs attached
for the good matches, and one counter line accounting for everything
else that was scanned.

It is a **LangGraph** pipeline with no LLM reasoning of its own — all
model calls happen inside the job-matcher API. That keeps job-pilot
fully testable with plain pytest, and the graph runtime is there for
the future: human-in-the-loop approval of outreach messages (v2) plugs
in as a checkpointer + `interrupt()`, not a rewrite (see ADR 0003).

## How it stays stateless

There is no database. DuckDB (in memory) anti-joins two public parquet
URLs — today's `main` file against the `trends/YYYYMMDD` tag of the
last successful run. New rows are the day's work; each job is analyzed
exactly once by construction. JD text is fetched from the company job
boards at match time and never stored.

```
fetch_new_jobs → filter_roles → match → render_pdfs → compose_email → send_email
                     └── no candidates ──────────────↗ (a quiet day still emails)
```

## Run it locally

```bash
cd agents/job-pilot
python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
cp .env.example .env          # fill in SMTP + matcher endpoints
.venv/bin/pytest -q           # 34 tests, no network, no secrets

# Dry run: real parquet + real filtering, writes runs/<date>/digest.html
# instead of sending. Paid /analyze calls still need RUN_PAID_MATCH=1.
.venv/bin/python run.py --dry-run --baseline trends/20260714
```

## Run it from GitHub Actions

`.github/workflows/job-pilot.yml` triggers after the daily
"job-scout daily trends" publish (plus manual dispatch) and runs the
GHCR image `ghcr.io/senthilsweb/job-pilot` (built by
`job-pilot-image.yml` on pushes to main). Repo secrets it needs:

`JOBMATCH_API_BASE`, `JOBMATCH_AGENT_BASE`, `SMTP_HOST`, `SMTP_PORT`,
`SMTP_USER`, `SMTP_PASS`, `DIGEST_TO`, `DIGEST_FROM`, and optionally
`LANGSMITH_API_KEY`, `OTEL_EXPORTER_OTLP_ENDPOINT`,
`OTEL_EXPORTER_OTLP_HEADERS`.

Two guards bound the LLM bill: `RUN_PAID_MATCH=1` must be set for any
paid call, and a delta larger than `max_jobs_per_run` (25) aborts
before the first call. The workflow never uploads artifacts — on a
public repo they are world-readable, and match results belong only in
your inbox.

## Configuration

- `config.yaml` — parquet URL template, category filter, PDF band
  threshold, run caps. Your target roles and salary floor are read from
  `../job-scout/config.yaml` (single source of truth).
- `inputs/resume.md` — the resume that gets scored. It is committed to
  this public repo (owner's decision), so keep it PII-scrubbed: no
  phone, no street address.
- `templates/letterhead.yaml` — the cover-letter letterhead (name,
  title line, contact, links, colors), mirroring the owner's personal
  letter format. Edit it and every PDF follows; the phone number comes
  only from `LETTERHEAD_PHONE` env, never from the committed file.
- `.env` — all secrets, never in config (see `.env.example`).

## Observability and failures

LangGraph traces go to LangSmith (`LANGSMITH_TRACING=true`); OTel spans
dual-export to OpenObserve and local Arize Phoenix. Missing telemetry
env just logs a warning — the email always comes first. Per-job
failures (a board API down, one analyze error) appear in the digest's
Failures section; run-level failures exit non-zero so the workflow goes
red. A quiet day still sends a short email — silence always means
something is broken.

## Documentation

The wiki lives at
[senthilsweb.github.io/ai-agents/job-pilot/](https://senthilsweb.github.io/ai-agents/job-pilot/):
[Getting Started](docs/getting-started.md) ·
[Configuration](docs/configuration.md) · [Runbook](docs/runbook.md) ·
[CI/CD](docs/ci-cd.md) · [FAQ](docs/faq.md)

## Design history

`openspec/changes/add-job-pilot/` (proposal, design, specs, tasks) and
`ai-dlc-in-practice/job-pilot/ceremonies-and-roles.md`. Stack decision:
`openspec/adr/0003-langgraph-for-python-orchestration.md`.
