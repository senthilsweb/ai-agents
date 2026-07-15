# Design — `job-pilot`

## Context

job-pilot is a thin, deterministic connector between two shipped systems:
the public job-scout trends parquet (data source) and the deployed
job-matcher API (the only LLM in the picture). Its own job is orchestration,
filtering, rendering, and delivery. That shapes every decision below:
deterministic code wherever possible, plain tests instead of LLM evals,
and a graph runtime chosen for what v2 needs (human in the loop), not for
what v1 needs.

## Architecture

One LangGraph `StateGraph`, linear with a single conditional edge:

```
fetch_new_jobs → filter_roles → has_candidates?
                                   ├─ yes → match → render_cover_pdfs → compose_email → send_email
                                   └─ no  ────────────────────────────→ compose_email → send_email
```

A quiet day still sends a short "no new matching jobs" email, so silence
always means "the pipeline is broken", never "there was nothing".

### State (single TypedDict)

```python
class PilotState(TypedDict):
    run_date: str                 # injected, not datetime.now() inside nodes
    baseline_tag: str             # trends/YYYYMMDD of last successful run
    new_jobs: list[JobFact]       # after anti-join
    candidates: list[JobFact]     # after role/salary filter
    matches: list[MatchResult]    # score, band, missing skills, letter text
    failures: list[Failure]       # node, job ref, reason — accumulated
    pdf_paths: list[str]
    email_html: str
    send_result: str
```

Every node is a pure-ish function `state -> partial state`; every node
wraps its work in try/except and appends to `failures` instead of raising,
except `fetch_new_jobs` and `send_email`, whose failure fails the run
(nothing sensible can happen after either).

### Nodes

1. **fetch_new_jobs** — in-memory DuckDB (`duckdb.connect()`), one SQL
   anti-join across two HTTPS parquet URLs (`main` vs `baseline_tag`) on
   `(company_name, req_id)`. No files written. The baseline tag comes from
   the CI wrapper (see ci-orchestration): the date of the last successful
   job-pilot workflow run, so a missed day widens the window automatically.
2. **filter_roles** — `category` pre-filter plus `title_keywords` regex
   and `base_salary_min_usd` floor, all read from job-scout's
   `config.yaml` `targets:` block (referenced, not duplicated).
   Category set pinned at the gate: `('Engineering & Tech', 'Product',
   'Sales & GTM')` — snapshot data showed Solutions Architect / FDE
   roles filed under Sales & GTM. Note: the parquet's `classification`
   column is currently empty; `category` is the populated one —
   verified 2026-07-15.
3. **match** — ports/reuses the JD harvest functions from job-scout's
   `tools/match_sweep.py` (`_ashby_descriptions`, `_greenhouse_descriptions`,
   `_workday_description`), uploads each JD as `.txt` to the agent
   `/upload` endpoint, calls `POST /analyze` in small batches with the
   resume. **Link-failure policy mirrors job-matcher: exactly one attempt,
   log, record the failure, continue with the other jobs — no retry.**
   A `MAX_JOBS_PER_RUN` cap (default 25) aborts before any paid call if
   the delta is suspiciously large (bad baseline, first run).
4. **render_cover_pdfs** — for matches at or above the configured band
   (default `good_match`), render the cover-letter text to PDF, named
   `slug(company-title).pdf`, into the run's temp dir. *Corrected
   2026-07-15 (Construction Correction 1): fpdf2, not WeasyPrint —
   WeasyPrint requires system pango/gobject; fpdf2 is pure Python and
   the letters are simple text documents.*
5. **compose_email** — one Jinja2 HTML template (autoescape on), three
   sections: **New jobs today** (all of `new_jobs`, matched or not, with
   title, company, location, salary, score/band, top 3 missing skills),
   **Matched — letters attached**, **Failures** (from `state.failures`).
6. **send_email** — Gmail SMTP (gate decision; app password) with the
   PDFs attached. Credentials from env only.

## Tech stack — LangGraph, not LangChain (ADR 0003)

Pinned by ADR `openspec/adr/0003-langgraph-for-python-orchestration.md`:

- **LangGraph `StateGraph` is mandatory; LangChain chains/agents are
  forbidden** in this agent. v1 is a straight pipeline and would be
  trivial in plain Python — the graph is bought for v2: LangGraph's
  checkpointer + `interrupt()` give human-in-the-loop approval (e.g.
  "approve this outreach message before it is sent") without a rewrite.
  LangChain's chain abstractions add surface without buying that.
- Python 3.12, `langgraph`, `duckdb`, `jinja2`, `weasyprint`,
  `pydantic` (state models), `pytest`. No `langchain` meta-package;
  `langchain-core` may appear only as a transitive dependency of
  langgraph, never imported directly.
- No LLM client library at all — the matcher API is plain HTTPS.

## Data design — stateless by construction

- The public parquet is the database. `main` is always the latest
  snapshot; every day has an immutable `trends/YYYYMMDD` tag. DuckDB
  queries both directly over HTTPS; nothing is downloaded to disk.
- "New since when?" needs no ledger: the CI wrapper asks the GitHub API
  for the last **successful** job-pilot run date and maps it to the tag.
  Worst case (ambiguity, deleted tag) is re-matching a job once — cents,
  and bounded by `MAX_JOBS_PER_RUN`.
- JD text is harvested at match time and lives only in runner memory /
  temp dir. The facts-only rule of `data/README.md` is inherited whole:
  **JD text, match JSON, cover letters, and the resume never enter the
  public repo and are never uploaded as workflow artifacts.**
- The resume lives **in the public repo** at
  `agents/job-pilot/inputs/resume.md` (owner's gate decision — direct
  access, no fetch token). Consequence accepted: the file is
  world-readable, so the committed copy should be scrubbed of phone and
  street address. Keeping the real file in git also closes the
  stale-placeholder trap job-scout's `matcher.resume_path` had: what is
  committed is what is scored.

## Observability

Three backends, standing on the repo's dual-export pattern:

- **LangSmith** — native: `LANGSMITH_TRACING=true` + `LANGSMITH_API_KEY`;
  LangGraph traces every node run with no code. Project name `job-pilot`.
- **OpenObserve** (`telemetry.nathansweb.com`) and **Arize Phoenix**
  (local `:6006`) — OTel spans via the existing dual-export env contract
  (see the telemetry-dual-export setup used by the eve agents): one root
  span per run carrying `run_date`, `baseline_tag`, counts; one child
  span per node; failure entries become span events.
- Environment split: local dev exports to all three; CI exports to
  LangSmith + OpenObserve (Phoenix is a local-only tool). Missing
  telemetry env vars degrade to a logged warning, never a crash — the
  email must go out even if tracing is down.

## Failure handling and logging

- Structured logging (reuse job-scout's timestamped-logfile pattern):
  every node logs start/end/counts; every failure logs job ref + reason.
- Per-job failures accumulate in `state.failures` and appear in the
  email's Failures section — the owner sees them without opening CI.
- Run-level failures (parquet unreachable, matcher API down, send
  failure) exit non-zero so the workflow goes red and GitHub notifies.
- In CI the log file is written to the runner and echoed to the job log
  (job facts and error reasons only — never JD text or letter content,
  since public-repo workflow logs are world-readable).

## Evals — code-level tests only

There is no LLM reasoning inside this agent, so there are no rubric/
LLM-judge evals. The eval suite is `pytest` and runs in CI on every push:

1. **delta**: fixture parquets (day N, day N+1) → anti-join returns
   exactly the added rows; unchanged and removed rows excluded.
2. **filter**: golden job-fact rows → in/out decisions for category,
   title keyword, and salary-floor rules; empty-classification tolerated.
3. **match-runner**: mocked ATS + matcher API → one-attempt-no-retry
   verified (mock counts calls), failure recorded and siblings continue,
   `MAX_JOBS_PER_RUN` aborts before any paid call.
4. **pdf**: letter text → PDF renders, non-empty, slug filename correct.
5. **email**: golden state → golden HTML (snapshot test); quiet-day and
   failures-section variants; autoescape verified with a hostile title.
6. **graph**: full `StateGraph` run with everything mocked → node order,
   conditional edge both ways, state accumulation.

## Docker + CI

- `Dockerfile`: `python:3.12-slim` + WeasyPrint system deps; image
  `ghcr.io/senthilsweb/job-pilot`, built/pushed by the workflow on
  changes to `agents/job-pilot/` (mirrors job-scout's container change).
- `.github/workflows/job-pilot.yml`: `workflow_run` on completion of
  `job-scout-trends.yml` (guarantees the fresh parquet is on `main`)
  + `workflow_dispatch`. Steps: resolve baseline tag via `gh api` →
  fetch resume from the private source → `docker run` the pipeline →
  no artifact upload.
- Paid-run guard: the container refuses to call `/analyze` unless
  `RUN_PAID_MATCH=1` (same convention as job-scout's image), and
  `MAX_JOBS_PER_RUN` bounds the bill even then.

## Secrets

From `.env` locally (python-dotenv, `.env` gitignored) and GitHub
Actions secrets in CI — never in `config.yaml`, never in the image:

| Secret | Purpose |
|---|---|
| `JOBMATCH_API_BASE`, `JOBMATCH_AGENT_BASE` | deployed matcher endpoints |
| `SMTP_HOST/PORT/USER/PASS` | Gmail SMTP (app password) |
| `DIGEST_TO`, `DIGEST_FROM` | addresses |
| `LANGSMITH_API_KEY` | tracing |
| `OTEL_*` per dual-export contract | OpenObserve auth |
| `RUN_PAID_MATCH` | paid-call guard |

## Security baseline

1. **Resume exposure** — owner decided at the gate the resume is
   committed to the public repo (world-readable). Mitigation: the
   committed copy is scrubbed of phone and street address; match
   results and cover letters (which embed personal narrative) still
   never leave the runner + email.
2. **Public-repo leak paths** — no workflow artifacts; job log echoes
   facts and error reasons only; email is the sole content channel.
3. **SSRF** — the agent fetches only ATS hosts derived from the parquet's
   known platforms (Ashby/Greenhouse/Workday API hosts) plus the two
   matcher endpoints; enforce a host allowlist on every outbound URL.
4. **Email/HTML injection** — job titles and JD-derived text render
   through Jinja2 with autoescape; covered by an eval with a hostile title.
5. **Prompt injection** — inherited from job-matcher's architecture
   (scores computed deterministically server-side, LLM never emits
   numbers); job-pilot adds no prompt surface of its own.
6. **Size caps** — JD text and resume capped (same limits as job-matcher)
   before upload; PDF count per email capped by the band threshold +
   `MAX_JOBS_PER_RUN`.
7. **Secrets hygiene** — env-only, masked by Actions, `.env` gitignored;
   no secret ever interpolated into a rendered template.

## Docs developed in parallel (part of this change)

- `agents/job-pilot/README.md` — plain-English, run-it-locally style
  (mirrors job-matcher's TUI-run README).
- Root `AGENTS.md` gains a job-pilot section (paths, run command).
- `ai-dlc-in-practice/job-pilot/ceremonies-and-roles.md` — updated at
  each gate, same discipline as job-matcher.
- ADR 0003 (LangGraph) lands with this change.
- Final docs pass is an explicit Construction bolt, not an afterthought.

## Non-goals (v1)

- **Persona outreach messages** (former manager / colleague / recruiter /
  hiring manager drafts) — v1.5; one extra API/LLM call per matched job,
  slots in as a node between `match` and `compose_email`.
- **Contact finding** — v2, human-in-the-loop by design (LinkedIn
  automation is off the table for ToS reasons); this is the feature the
  LangGraph checkpointer + `interrupt()` choice is reserved for.
- **Follow-up tracking** — v2; needs the one genuinely private state
  (an outreach ledger), which will live in private storage, not here.
- **Reply detection / inbox integration**, **GUI**, **any change to
  job-scout or job-matcher**.
