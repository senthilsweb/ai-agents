# Configuration

At the end you will know every knob and secret job-pilot reads, and
where each one lives.

Three files, one rule: **tunables in YAML, secrets in `.env`** (GitHub
Actions secrets in CI). Never put a secret in a YAML file — the repo is
public.

## `config.yaml` — pipeline knobs

| Key | Meaning | Default |
|---|---|---|
| `parquet.url_template` | where the public snapshots live (`{ref}` = `main` or a `trends/YYYYMMDD` tag) | GitHub raw URL |
| `filter.categories` | job categories allowed through | Engineering & Tech, Product, Sales & GTM |
| `filter.us_only` | drop known non-US locations before the paid call; "Remote" and other ambiguous values stay eligible, and dropped jobs still show in the digest table | `true` |
| `filter.targets_config` | path to job-scout's `config.yaml` — the single source for title keywords and the salary floor | `../job-scout/config.yaml` |
| `matcher.resume_path` | the resume the matcher scores | `./inputs/resume.md` |
| `matcher.pdf_band_threshold` | attach cover letters from this match band up | `good_match` |
| `matcher.max_jobs_per_run` | above this, the run skips the paid match step (not aborts — see `MAX_JOBS_PER_RUN` below) and reports it in the digest | `25` |
| `email.subject_template` | subject line with `{date}` `{new}` `{candidates}` `{matched}` `{strong}` `{pdfs}` placeholders; a typo renders empty, never blocks the send | counts-first template |

Target roles and the salary floor are **not** duplicated here — edit
them once in job-scout's `config.yaml` and both agents follow.

## `templates/letterhead.yaml` — the cover-letter letterhead

Name, title line, contact fields, links, and colors for the PDF header
and signature. Edit it and every letter follows; no code change. The
phone number is deliberately empty in the committed file — it arrives
via the `LETTERHEAD_PHONE` secret at run time.

## `inputs/resume.md` — the resume

Committed to the repo, so what is committed is what is scored. Keep it
scrubbed: no phone number, no street address (the repo is public).

## `.env` / GitHub secrets

| Variable | Purpose |
|---|---|
| `JOBMATCH_API_BASE`, `JOBMATCH_AGENT_BASE` | deployed job-matcher endpoints |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Gmail SMTP (app password) |
| `DIGEST_TO`, `DIGEST_FROM` | email addresses; `DIGEST_TO` accepts a comma-separated list (`a@x.com, b@y.com`) |
| `RUN_PAID_MATCH` | paid-call switch — `1` allows `/analyze` calls; unset/not `1` hard-aborts the run |
| `MAX_JOBS_PER_RUN` | optional, one-run override of `matcher.max_jobs_per_run` — e.g. a manual catch-up dispatch (`job-pilot.yml`'s `max_jobs_per_run` input) after a coverage-expansion burst day skipped matching |
| `LETTERHEAD_PHONE` | phone for the PDF letterhead |
| `LANGSMITH_TRACING`, `LANGSMITH_API_KEY`, `LANGSMITH_PROJECT` | LangSmith tracing (optional) |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` | OpenObserve span export (optional) |
| `PHOENIX_COLLECTOR_ENDPOINT`, `PHOENIX_CLIENT_HEADERS` | Arize (cloud `otlp.arize.com` or local Phoenix) (optional) |

All observability values are optional: when one is missing, the run
logs a warning and continues — the email always comes first.

Next: [Runbook](runbook.md)
