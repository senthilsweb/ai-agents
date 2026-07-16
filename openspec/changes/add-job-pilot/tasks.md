# Tasks — `job-pilot`

Ordered by ceremony. Construction tasks MUST NOT start before
`.openspec.yaml` reads `status: approved` (see AI-SDLC-TAILORING.md).

## Open questions for the Inception gate

Resolved at the gate — see Sign-off below.

**Sign-off (2026-07-15, repo owner, Inception gate):**
1. Agent name confirmed: **job-pilot**.
2. PDF threshold: **good_match (≥65) and above**. Known caveat accepted:
   the matcher's analyst model is currently Haiku, which scores
   leniently, so busy days may attach several PDFs (bounded by
   `MAX_JOBS_PER_RUN`).
3. Email provider: **Gmail SMTP** (app password; `SMTP_*` secrets from
   env / GitHub secrets — Resend not used).
4. Resume source: **kept in the public git repo, direct access** —
   owner's explicit decision, overriding the drafted private-source
   design. No fetch token needed. Recommendation logged: scrub phone /
   street address from the committed copy, since the public repo is
   world-readable.
5. Category filter: **('Engineering & Tech', 'Product', 'Sales & GTM')**
   — snapshot data (2026-07-15) showed Solutions Architect, Forward
   Deployed Engineering Manager, and Applied AI Engineer postings filed
   under Sales & GTM; excluding it would drop roles the owner's
   `title_keywords` explicitly name.

## Inception (Mob Elaboration)

- [x] Study prior art: job-scout match pipeline (`tools/daily_match.py`,
      `match_sweep.py`), public parquet schema + tag scheme (verified
      live 2026-07-15: anti-join over HTTPS works, 123 new jobs vs
      trends/20260714; `classification` empty, `category` populated)
- [x] Draft proposal.md / design.md / tasks.md / four capability specs
- [x] Draft ADR 0003 (LangGraph, not LangChain)
- [x] Draft `ai-dlc-in-practice/job-pilot/ceremonies-and-roles.md`
- [x] Repo owner reviews open questions above (Sign-off 2026-07-15)
- [x] **Inception gate**: `.openspec.yaml` → `status: approved`

## Construction

### Bolt 1 — scaffold + delta + filter (pure, no network in tests)

- [x] `agents/job-pilot/` scaffold: `pyproject.toml`, `pipeline/` package,
      `config.yaml` reference to job-scout targets, `.env.example`
- [x] `pipeline/state.py` (pydantic models), `pipeline/delta.py`
      (in-memory DuckDB anti-join over two parquet URLs),
      `pipeline/filters.py` (category + title keywords + salary floor)
- [x] Evals 1–2 (delta fixtures, filter goldens) green in pytest
      (12 passed, 2026-07-15; config loader verified against the real
      job-scout targets: 11 keywords, floor 220000)

### Bolt 2 — match runner

- [x] Port JD harvest helpers from job-scout `match_sweep.py`
      (Ashby/Greenhouse/Workday) with host allowlist + size caps
- [x] `/upload` + `/analyze` client; one-attempt-no-retry policy;
      failure accumulation; `MAX_JOBS_PER_RUN` + `RUN_PAID_MATCH` guards
- [x] Eval 3 (mocked APIs: retry policy, sibling continuation, cap
      aborts before any paid call) green (19 passed total, 2026-07-15)

### Bolt 3 — PDFs + email

**Correction 1 (2026-07-15, Construction):** WeasyPrint dropped for
**fpdf2**. WeasyPrint needs system pango/gobject (brew on macOS, apt in
Docker) and failed to import on the dev machine; fpdf2 is pure Python,
zero system deps, and cover letters are simple text documents — same
right-sizing call as job-matcher's Correction 3 (Docling → unpdf).
Consequences: PDF layout is drawn in code (no HTML parsing, so the PDF
path is injection-safe by construction); non-latin-1 characters are
transliterated (em-dash, curly quotes) since fpdf2 core fonts are
latin-1. design.md + email-digest spec amended with dated notes.

- [x] `pipeline/letters.py` — fpdf2 PDF, slug filenames
- [x] `pipeline/digest.py` — three-section HTML template (autoescape),
      quiet-day variant, Gmail SMTP send + attachments (send folded into
      digest.py — small enough that a separate send.py was overhead)
- [x] Evals 4–5 (PDF smoke, golden-HTML snapshots incl. hostile title)
      green (29 passed total, 2026-07-15)

### Bolt 4 — graph + telemetry + logging

- [x] `pipeline/graph.py` — `StateGraph` wiring with the conditional
      edge; `run.py` entrypoint (injects `run_date`, `baseline_tag`,
      `--dry-run` writes the HTML instead of sending)
- [x] LangSmith native tracing (env-only) + OTel dual export
      (OpenObserve + Phoenix) in `pipeline/telemetry.py`;
      degrade-to-warning when telemetry env is absent
- [x] Timestamped log file per run (run.py, job-scout pattern)
- [x] Eval 6 (graph wiring, both edge branches, guard/fetch failures
      fail the run) green — 34 passed total. Live e2e dry run
      2026-07-15: real parquet over HTTPS (123 new vs trends/20260714)
      → 5 real candidates (OpenAI/Cursor/Snowflake/Coder/Harvey) →
      mocked analyze → 3 PDFs → digest.html rendered

### Bolt 5 — Docker + GitHub Action

- [x] `Dockerfile` (python:3.12-slim, pure-Python deps — no apt
      packages needed after Correction 1) →
      `ghcr.io/senthilsweb/job-pilot`; built + smoke-tested locally
      2026-07-15 (config loads in-image: 95 slugs, 11 keywords)
- [x] `.github/workflows/job-pilot.yml`: `workflow_run` after
      "job-scout daily trends" + `workflow_dispatch` with optional
      baseline input; baseline tag via `gh api` (last successful run,
      else yesterday); secrets wired; **no artifact upload**.
      `job-pilot-image.yml`: pytest on every push touching the agent,
      GHCR image push on main. (Resume fetch step dropped — resume is
      committed per the gate decision.)
- [x] Security-baseline pass over design.md §Security (2026-07-15):
      (1) resume — committed-and-scrubbed policy documented in
      inputs/README.md; **file itself not yet added — owner action
      before Verification** (the pipeline fails at /analyze without
      it). (2) leak paths — no artifacts in either workflow; logs carry
      counts + error reasons only; runs/ and logs/ gitignored.
      (3) SSRF — `_check_host` allowlist (ashby/greenhouse/workday
      hosts) on every harvest URL; matcher endpoints come from env
      (trusted config). (4) injection — Jinja2 autoescape (hostile-title
      test green); PDFs drawn as literal text. (5) prompt injection —
      inherited: scores computed server-side deterministically.
      (6) caps — JD min/max chars, 20MB response cap, max_jobs_per_run,
      RUN_PAID_MATCH. (7) secrets — env-only, .env gitignored, GitHub
      secrets masked. No unresolved gaps beyond the resume action item.

### Docs finale (required before `status: implemented`)

- [x] `agents/job-pilot/README.md` (plain-English run guide)
- [x] Root `AGENTS.md` job-pilot section
- [x] `ceremonies-and-roles.md` updated with Construction record
- [x] Cross-artifact consistency pass (2026-07-15): Correction 1
      (fpdf2) propagated to design.md, email-digest spec, Dockerfile,
      README; gate decisions propagated to proposal.md, design.md,
      ci-orchestration + email-digest specs, .env.example

## Verification (live)

- [x] First guarded live run from GitHub Actions: run 29460782335
      (2026-07-16 00:12 UTC, baseline trends/20260714) — 123 new →
      3 candidates (62 US-gated) → 3 analyzed, 0 failures → 3 PDFs →
      digest sent with 3 attachments. Owner inbox confirmation of
      content pending.
- [ ] Traces visible in LangSmith / OpenObserve / Arize for that run
      (exporter logged "2 endpoint(s)" + LangSmith env set; visual
      check pending)
- [x] Quiet-day run verified: run 29460731505 (2026-07-16 00:11 UTC,
      baseline resolved to trends/20260715 = main) — 0 new jobs, short
      email sent, green workflow
- [ ] `.openspec.yaml` → `status: verified` (after owner confirms the
      email + traces)
