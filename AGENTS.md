# Agents — Vercel Eve Monorepo

This monorepo hosts multiple [eve](https://vercel.com/eve) agents. Each agent
lives under `agents/<name>/` and follows the shared conventions below.

Before writing code for any agent, read the relevant guide in `node_modules/eve/docs/`.

Every non-trivial change goes through `openspec/changes/<name>/` (proposal →
design → tasks → spec) before and during implementation — **this applies
repo-wide (root-level tooling, `shared/`, `openspec/` itself, and every
`agents/<name>/`), not just agent code.** See `AI-SDLC-TAILORING.md` at the
repo root for the full process, its status lifecycle (`proposed → approved →
implemented → verified → archived`), and where it deliberately trades the
full AI-DLC methodology for a lighter-weight equivalent.

---

## Agents

### Diagram Generator (`agents/diagram-generator/`)

Generates stunning, self-contained HTML architecture diagrams from a description
or reference image. Records each run under a timestamped `runs/` folder with a
metrics report.

All paths below are relative to `agents/diagram-generator/`:

- `agent/instructions.md` — the always-on **Orchestrator** system prompt.
- `agent/skills/*.md` — load-on-demand procedures: `design_system`,
  `build_spec`, `render_diagram`, `write_report`, `cost_rates`,
  `report_template`, `prompt_template`.
- `agent/tools/*.ts` — typed tools: `create_run`, `write_run_file`,
  `read_run_file`, `fetch_lucide_icon`, `render_screenshot`.
- `agent/sandbox/sandbox.ts` — Docker backend + Playwright bootstrap; seeds
  `inputs/` and `runs/` into `/workspace`.
- Built-in `agent` tool delegates renderer/reporter copies that share the sandbox.

Run: `cd agents/diagram-generator && npm run dev`

### API Test Generator (`agents/api-test-generator/`)

Turns an OpenAPI 3.x specification into a production-ready Postman collection
with pairwise test coverage, Newman execution, and a coverage report. Uses a
three-model strategy: Sonnet (orchestrator), Opus (combinatorial factor analysis),
Haiku (assertion script generation). 95% deterministic by token count.

All paths below are relative to `agents/api-test-generator/`:

- `agent/instructions.md` — the always-on **Orchestrator** system prompt.
- `agent/skills/*.md` — load-on-demand skills: `openapi_parse`, `naming_rules`,
  `pairwise_strategy`, `collection_assembly`, `assertion_contract`, `report_template`.
- `agent/tools/*.ts` — deterministic tools: `parse_openapi`, `apply_naming_rules`,
  `generate_pairwise_matrix`, `assemble_collection`, `run_newman`,
  `validate_collection`, `assemble_report`.
- `agent/subagents/pairwise-designer/` — claude-opus-4-8 subagent for factor analysis.
- `agent/subagents/assertion-writer/` — claude-haiku-4-5-20251001 subagent for pm.test() generation.
- `openspec/openspec.md` — full design specification.
- Drop OpenAPI specs into `agent/sandbox/workspace/inputs/`.

Run: `cd agents/api-test-generator && npm run dev`

### Privacy Classifier (`agents/privacy-classifier/`)

Classifies a document's PII/NPI content and the compliance regimes it
implicates (GDPR, CCPA/CPRA, India's DPDP Act, Argentina's PDPL, HIPAA, LGPD,
PIPEDA), independent of any downstream consumer. Fully single-agent — no
declared subagents. Fully deterministic except one step: PII/NPI detection,
made via a direct, parallel, strongly-typed `generateObject` call rather than
a subagent. Detection itself is swappable across four engines (`PII_ENGINE`):
`presidio` (local, no GenAI), `presidio_genai`, `openai_privacy_filter`
(reserved, not yet implemented), or `genai_only`. Local/on-prem only — see
`agents/privacy-classifier/PREREQUISITES.md` for external dependencies and
why this doesn't work as a Vercel serverless deployment.

All paths below are relative to `agents/privacy-classifier/`:

- `agent/instructions.md` — the always-on **Orchestrator** system prompt.
- `agent/tools/*.ts` — deterministic tools: `create_run`, `load_input`,
  `classify_document_structure` (columnar gate, shared re-export),
  `extract_document_text` (Docling, in-sandbox Python exec, OCR fallback),
  `chunk_text` (Chonkie semantic chunker, in-sandbox Python exec),
  `normalize_findings`, `map_compliance_impact`, `assemble_report`; plus
  `detect_privacy_entities`, the one engine-routed tool that calls a GenAI
  model and/or Presidio (Python, in-sandbox exec).
- `agent/sandbox/sandbox.ts` — bootstraps Python 3 + `docling` +
  `presidio-analyzer` + a spaCy model + `chonkie[semantic]` + `tesseract-ocr`
  (cached).
- `openspec/changes/add-privacy-classifier/` — the full design spec.
- `PREREQUISITES.md` — external dependencies and the Vercel-deployment caveat.
- `evals/*.eval.ts` — first adopter of eve's native eval harness in this repo.

Run: `cd agents/privacy-classifier && npm run dev`

### Job Matcher (`agents/job-matcher/`)

Compares a candidate's resume against one or more job postings and produces
one scored, evidence-grounded JSON report per job — a governed rebuild of
the vibe-coded `agents/talent-align/` prototype (kept untouched as the
"before" teaching prop), and the running example for
`ai-dlc-in-practice/job-matcher/`. Headless, no GUI (`nextjs-gui/` is a
reserved later phase). One generative step only: typed skill/evidence
extraction. Scoring is a pure deterministic function (`agent/lib/scoring.ts`)
— the LLM never emits a number, which is also the agent's prompt-injection
defense. Fan-out: exactly one job link runs through a direct tool call
(`analyze_job_fit`); more than one delegates to the `job-analyst` subagent
once per job, each its own eve session.

All paths below are relative to `agents/job-matcher/`:

- `agent/instructions.md` — the always-on **Orchestrator** system prompt.
- `agent/tools/*.ts` — deterministic tools: `create_run`, `load_input`,
  `extract_resume_text` (pure Node: unpdf for PDF, mammoth for DOCX — no
  Python/Docling, no OCR, scanned PDFs rejected),
  `fetch_job_postings` (one call for every job source, bounded concurrency,
  exactly one attempt per source, no retry), `score_job_fit`,
  `assemble_report`; plus `analyze_job_fit`, the one tool that calls a
  GenAI model (the N=1 direct-call path — mirrors privacy-classifier's
  tool-wraps-the-model-call pattern).
- `agent/subagents/job-analyst/` — the N>1 fan-out path; `outputSchema` on
  its own `agent.ts` runs it in task mode, returning a validated
  `JobAnalysis` directly, no raw-JSON-in-prose parsing.
- `agent/lib/scoring.ts` — the pinned scoring formula (40/20/20/20 +
  match bands), pure and unit-eval-covered before any tool wraps it.
- `agent/sandbox/sandbox.ts` — plain shared base sandbox (no Python
  bootstrap, unlike privacy-classifier), so the agent deploys on Vercel
  the same way as linkedin-cover-generator.
- `openspec/changes/add-job-matcher/` — the full design spec, including a
  "Security baseline" section and two logged Construction-time corrections.
- `evals/*.eval.ts` — 8 evals; `evals/rubrics.md` states the canonical
  scoring formula and HARD/SOFT pass criteria for each, written at
  Inception. `evals/data/` holds a real resume + real 2026-07-09
  LinkedIn-sourced job postings, including two genuine JavaScript-shell
  fetch failures kept as fixtures for the graceful-failure requirement.

Run: `cd agents/job-matcher && nvm use 24 && npx eve dev --port 3535`
(use `npx eve dev` directly, not `npm run dev` — the latter can pick up
the wrong Node version; see the agent's README)

### Job Pilot (`agents/job-pilot/`)

Daily job-qualification digest: finds jobs **new since its last run**
in job-scout's public trends parquet (in-memory DuckDB anti-join over
two HTTPS URLs — fully stateless, no database file), filters them by
the owner's target roles, scores only those through the deployed
job-matcher API, and emails one digest with cover-letter PDFs attached
for `good_match`-and-up. **LangGraph** `StateGraph`, no LangChain
chains (ADR 0003 — the graph is reserved for v2 human-in-the-loop
outreach approval). No LLM reasoning of its own, so evals are plain
pytest.

All paths below are relative to `agents/job-pilot/`:

- `pipeline/` — `state.py` (pydantic models), `delta.py` (parquet
  anti-join), `filters.py` (category + title keywords + salary floor,
  read from job-scout's `config.yaml`), `matcher.py` (JD harvest with
  host allowlist, `/upload` + `/analyze` client, one-attempt-no-retry,
  `RUN_PAID_MATCH` + `max_jobs_per_run` guards), `letters.py` (fpdf2
  PDFs), `digest.py` (Jinja2 autoescaped HTML + Gmail SMTP),
  `telemetry.py` (LangSmith native + OTel dual export, degrades to a
  warning), `graph.py` (the StateGraph).
- `run.py` — entrypoint; `--dry-run` writes the HTML instead of sending.
- `tests/` — 34 code-level tests, no network, no secrets.
- CI: `.github/workflows/job-pilot.yml` (digest, after the daily trends
  publish; never uploads artifacts) + `job-pilot-image.yml` (tests on
  every push, GHCR image `ghcr.io/senthilsweb/job-pilot` on main).
- `openspec/changes/add-job-pilot/` (repo root) — the full design spec.

Run: `cd agents/job-pilot && .venv/bin/python run.py --dry-run`

### YouTube Transcriber (`agents/youtube-transcriber/`)

Turns a YouTube video ID or link into the **full spoken transcript** — the
actual audio, transcribed end to end, not the captions, description, or
title. **LangGraph** `StateGraph`, no LangChain chains (ADR 0003). ASR is
local `faster-whisper`, so there is **no LLM anywhere in the pipeline** —
no prompt, no completion, no tokens, no API key, and audio never leaves the
machine. Evals are therefore plain pytest. Shipped as a local CLI (gate
decision 2026-07-23), plus an optional **REST service + Firecracker microVM
deployment** added by the `add-youtube-transcriber-service` change
(2026-07-24), which amends that gate's no-Docker/no-server items. The CLI and
the pipeline are unchanged — the service imports and calls them.

All paths below are relative to `agents/youtube-transcriber/`:

- `pipeline/` — `state.py` (pydantic models; `VideoRef` validates the
  11-char id), `config.py` (env-driven ASR settings and caps),
  `resolve.py` (the only untrusted-input boundary: host allowlist, id
  regex, strips every query param, duration cap), `ytdlp.py` +
  `audio.py` (argument-list subprocesses, tenacity retry on download
  only, 16 kHz mono opus cache keyed by video id), `transcribe.py`
  (faster-whisper adapter — CPU only, CTranslate2 has no Metal backend),
  `outputs.py` (json + md + srt + metrics), `telemetry.py` (OTel,
  degrades to a warning), `graph.py` (the StateGraph; one conditional
  edge for the audio cache).
- `run.py` — CLI; takes N videos, runs them sequentially, isolates
  per-video failures, exits non-zero if any failed.
- `server/app.py` — FastAPI service (the 2026-07-24 addition). Loads the
  ASR model once at startup (reuses `transcribe.load_model`, so the model
  is resident), then serves async jobs: `POST /transcribe` enqueues and
  returns a job id, `GET /jobs/{id}` polls, `GET /jobs/{id}/transcript.{md,srt,json}`
  serves artifacts, `GET /healthz`. Every request input goes through
  `resolve.parse_video_ref` before it reaches the pipeline. Adds no logic
  to `pipeline/` — it calls `run_one` unchanged.
- `Dockerfile` — agent-root, same convention as job-pilot/job-scout;
  `python:3.12-slim` + `ffmpeg` + `pip install .`, with the ~1 GB
  distil-large-v3 weights **baked in** so the container/microVM boots with
  no download. `CMD` runs uvicorn.
- `tests/` — 90 tests (73 pipeline + 17 across the graph/server), no
  network, no model, no secrets. `tests/test_server.py` stubs `run_one` and
  exercises the job lifecycle, id validation, and artifact endpoints.
- `runs/` and `.cache/` are **gitignored** — the second deliberate
  exception to the runs/-is-committed convention (after job-matcher's),
  because transcripts are verbatim third-party speech and this repo is
  public. The service upholds this: transcripts stay inside the VM and are
  returned only to the requesting caller.
- Prerequisites: `ffmpeg` (`brew install ffmpeg`) and a one-time ~1 GB
  Whisper weights download (baked into the image for the deployed path).
- `openspec/changes/add-youtube-transcriber/` (repo root) — the full
  design spec; `add-youtube-transcriber-service/` — the service + microVM
  amendment.
- Deployment tooling is **generic**, not agent-specific: `infra/firecracker/`
  (repo root) turns any agent's container image into a Firecracker microVM.
  **microVM deployment verified** 2026-07-24 on Intel bare metal — default boot
  serves the resident distil-large-v3 model (`model_loaded:true`, ~8s); real
  transcript content stays cookie-gated (YouTube blocks datacenter IPs).
- CI: `.github/workflows/youtube-transcriber-image.yml` — tests on every push
  touching the agent; on `main`, builds + pushes GHCR image
  `ghcr.io/senthilsweb/youtube-transcriber` (buildx, amd64, gha-cached weights
  layer; auth via built-in `GITHUB_TOKEN`, no custom secret).

Run (CLI): `cd agents/youtube-transcriber && .venv/bin/python run.py <video-id-or-url>`
Run (service): `cd agents/youtube-transcriber && .venv/bin/uvicorn server.app:app --port 8000`

### langgraph-hello (`agents/langgraph-hello/`)

A deliberately tiny **LangGraph** `StateGraph` (ADR 0003, no LangChain chains)
with **no LLM, no network, no weights, no API key**. It normalizes text,
branches on empty-vs-text (one conditional edge), computes simple stats, and
probes its own environment. Its second job is to be a **clean Firecracker
microVM smoke test**: tiny image, fast boot, and its `probe` node / `GET
/whoami` report the guest kernel, hostname, and eth0 IP that *prove* microVM
isolation. Born 2026-07-24 because the youtube-transcriber service couldn't
exercise the Firecracker path (its host has no `/dev/kvm`, and YouTube blocks
the datacenter IP).

All paths below are relative to `agents/langgraph-hello/`:

- `pipeline/` — `state.py`, `config.py` (`MAX_INPUT_CHARS`), `probe.py`
  (env probe), `graph.py` (the StateGraph:
  `normalize → route → {echo_empty|analyze} → probe → assemble`).
- `run.py` — CLI; `server/app.py` — `GET /healthz`, `POST /run`, `GET /whoami`.
- `tests/` — 10 pytest, no network, no secrets. `Dockerfile` — slim + uvicorn,
  ~200 MB.
- Reuses the generic `infra/firecracker/` tooling unchanged for the microVM.
- CI: `.github/workflows/langgraph-hello-image.yml` → GHCR image
  `ghcr.io/senthilsweb/langgraph-hello`.
- `openspec/changes/add-langgraph-hello/` (repo root) — the design spec.
  **microVM boot verified** 2026-07-24 on Intel bare metal (guest kernel
  5.10.233 vs host 6.8.0 via `GET /whoami` = a real microVM). The bring-up
  also hardened `infra/firecracker/` (modern kernel + entropy device).

Run (CLI): `cd agents/langgraph-hello && .venv/bin/python run.py "hello world"`
Run (service): `cd agents/langgraph-hello && .venv/bin/uvicorn server.app:app --port 8000`

### Talk Value Stats (`agents/talk-value-stats/`)

Turns a talk's **transcript** into a published, blog-style **stats site** plus a
**DuckDB-queryable parquet**: `transcript → GenAI extraction → one JSON DB →
static site + parquet → GitHub Pages`. Each page shows the video (thumbnail,
title, speaker(s)) and one card per example — its use case and the quantified
outcomes (cost savings, revenue, productivity, FTE, cycle time, …) — with
**every number grounded to the verbatim quote** and a deep link to the moment
it was said. Born 2026-07-24 by **promoting** what started as
`youtube-transcriber/site/` into its own agent, precisely so the transcriber
keeps its clean "no LLM anywhere" identity: this is the one agent that calls a
model (and only in `extract.py`). It **consumes** the transcriber's
`runs/*/transcript.md`; it never produces transcripts.

All paths below are relative to `agents/talk-value-stats/`:

- `schema.py` — the pydantic v2 source of truth (`schemaVersion: 2`):
  `TranscriptStatsPage` (one video → `speakers[]` → ordered `examples[]` →
  ordered `metrics[]`), `Person`, and `ExtractedContent` (what the model
  returns — the judgement part only; the extractor assembles the authoritative
  `VideoSource` from the transcript header). Metrics are a **uniform list tagged
  by an 8-value `category` enum** (+ `other` escape hatch), never fixed named
  fields — real talks state numbers fixed slots can't hold (200 bps EBITA,
  85,000 lives, 400×).
- `extract.py` — the CLI + **the only GenAI call in the monorepo**. Reads a
  `transcript.md`, calls Claude via `client.messages.parse(output_format=…)`
  (structured outputs), and **upserts `db.json` by `videoId`**. Model from env
  (`MODEL_STATS_EXTRACTOR` → `MODEL` → error); transcripts from the sibling
  `youtube-transcriber/runs/` (override `$TRANSCRIBER_RUNS`).
- `db.json` — the JSON DB (a single committed array of pages).
- `build.py` + `templates/` — **multipage static** generator (Jinja2 → `dist/`):
  `index.html` + one crawlable `<slug>.html` per talk, server-rendered (SEO/link-
  preview friendly; the only JS is a progressive-enhancement scroll listener). An
  editorial **"timeline"** design (light, evergreen accent) — a horizontal
  talk-scrubber plots every stat moment across the runtime, then a vertical
  timeline hangs each number off its timestamp. Bespoke CSS in `base.html.j2`
  (CSS variables) + Google Fonts; no framework, no CSS build.
- `export.py` — flattens `db.json` to `dist/stats.parquet` (one row per metric,
  denormalized, with a `watchUrl` deep link) for **DuckDB** — including remotely
  over HTTPS once on Pages, the same pattern job-pilot uses on job-scout's parquet.
- `tests/` — pytest, no network/model/key, with a committed transcript fixture.
- CI: `.github/workflows/talk-value-stats.yml` — test → build → **GitHub Pages**
  on `main` (no secret; never sees a transcript).
- `openspec/changes/add-talk-value-stats/` (repo root) — the design spec and the
  content/privacy decision (commit `db.json` vs keep local).

Run (extract): `cd agents/talk-value-stats && MODEL_STATS_EXTRACTOR=claude-opus-4-8 python extract.py <transcript.md|video-id>`
Run (build): `cd agents/talk-value-stats && python build.py && (cd dist && python3 -m http.server 8080)`

---

## Monorepo Conventions

- Add agent-private helpers under `agent/lib/` (import-only, never mounted).
  Cross-agent shared code lives in the root `shared/` npm workspace package —
  import it as `shared/lib/<module>.js` (a real workspace dependency, listed
  in the agent's `package.json`), **not** a relative `#shared/*` path; see
  `openspec/adr/0001-shared-agent-runtime-kit.md` §1 for why.
- Skills are scoped per agent; copy markdown under each agent that needs it.
- Generic host/deployment tooling (not tied to one agent) lives at the repo
  root under `infra/<tech>/` — e.g. `infra/firecracker/` packages any agent's
  container image as a Firecracker microVM. Keep it parameterized and
  agent-agnostic; agent-specific service code (a `server/`, a `Dockerfile`)
  stays inside the agent. (`shared/` is a TypeScript/npm workspace and is not
  the home for shell/host infra.)
- **Agent Sandbox (Firecracker microVMs):** `infra/firecracker/README.md` is the
  authoritative guide — from a fresh bare-metal box (`/dev/kvm` required) to
  building rootfs images and spinning up a microVM per agent, plus management
  and systemd persistence. The hard-won gotchas (a container hides four things a
  microVM needs — kernel entropy, PATH, DNS, HOME/ENV) are consolidated in
  `openspec/observations/0003-firecracker-microvm-bringup.md`.
- Subagents are declared under `agent/subagents/<name>/` with their own
  `agent.ts`, `instructions.md`, `sandbox/`, and `skills/`.
- `runs/` is committed so history is preserved. **Exception:**
  job-matcher's runs are gitignored — they contain the candidate's real
  resume/PII (see `openspec/changes/refactor-job-matcher/proposal.md` D8,
  which also questions this convention repo-wide).
- All models are resolved from env vars — no hard-coded model defaults.
  Each role resolves `MODEL_<ROLE>_* → MODEL_* → startup error`.
