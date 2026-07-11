# Job Matcher

Compares a candidate's resume against one or more job postings and produces
one scored, evidence-grounded JSON report per job. A governed rebuild of
the vibe-coded prototype at `agents/talent-align/` (kept unchanged as the
"before" picture), and the running teaching example for
[`ai-dlc-in-practice/job-matcher/`](../../ai-dlc-in-practice/job-matcher/).

See `openspec/changes/add-job-matcher/` for the full design (proposal,
design, spec, tasks) and `evals/rubrics.md` for the scoring formula and
every eval's pass criteria.

## Prerequisites

- **Node 24+** — Eve requires it. Use `nvm use 24` if you have multiple versions.
- **Docker** — the local sandbox uses `ghcr.io/vercel/eve:latest`. On Vercel
  deployments it auto-switches to Vercel Sandbox.
- Network access to your model provider (any OpenAI-compatible provider or
  the Vercel AI Gateway).

Resume extraction is pure Node (`unpdf` for PDF, `mammoth` for DOCX) — no
Python, no Docling, no heavy sandbox bootstrap — so this agent is
deployable on Vercel the same way as `linkedin-cover-generator`.

## Setup

### 1 — Install dependencies

From the **repo root** (installs all workspace agents):

```bash
nvm use 24
npm install
```

### 2 — Configure environment variables

This agent has its **own `.env` file** in the agent folder. Eve loads it
when you run `eve dev` from there.

```bash
cd agents/job-matcher
cp .env.example .env   # fill in MODEL_ORCHESTRATOR / MODEL_JOB_ANALYST credentials
```

## Run in dev mode (interactive TUI)

From the **agent folder**:

```bash
nvm use 24
npx eve dev --port 3535
```

This starts `eve dev` — an interactive TUI where you type prompts. Run
artifacts are synced from the sandbox back to
`agent/sandbox/workspace/runs/` after each run.

> **Note:** Use `npx eve dev` directly rather than `npm run dev`. The
> latter may pick up the wrong Node version from your shell. Always
> activate Node 24 first with `nvm use 24`.

## Model configuration

Both roles (`MODEL_ORCHESTRATOR` and `MODEL_JOB_ANALYST`) are env-driven.
Each role resolves `MODEL_<ROLE>_*` → `MODEL_*` → an explicit startup
error (no built-in default, per ADR 0001 §4).

### How the resolver picks a provider

`shared/lib/model.ts` decides the provider from what you set:

| You set | Provider used | Requests go to |
|---|---|---|
| `BASE_URL` **and** `API_KEY` | OpenAI-compatible | `<BASE_URL>/chat/completions` |
| `API_KEY` only (Anthropic key, `BASE_URL` blank) | Native Anthropic | Anthropic Messages API |
| Neither (model id only + `AI_GATEWAY_API_KEY`) | Eve AI Gateway | Vercel AI Gateway |

### Frontier model base URLs

| Provider | Example model id | `MODEL_<ROLE>_BASE_URL` | Notes |
|---|---|---|---|
| **Anthropic (Claude)** | `claude-sonnet-5` | **leave blank** | Blank + an `sk-ant-...` key uses the native Anthropic provider. Do **not** set `https://api.anthropic.com` — it has no `/chat/completions` endpoint, so every call fails with `404 Not Found`. Anthropic's OpenAI-compatible layer is `https://api.anthropic.com/v1/`, but Anthropic documents it as a test/evaluation tool, not for production. |
| **OpenAI** | `gpt-5.4-mini` | `https://api.openai.com/v1` | |
| **Google Gemini** | `gemini-2.5-pro` | `https://generativelanguage.googleapis.com/v1beta/openai/` | Google's OpenAI-compatible layer. |
| **xAI (Grok)** | `grok-4` | `https://api.x.ai/v1` | |
| **DeepSeek** | `deepseek-chat` | `https://api.deepseek.com/v1` | |
| **Mistral** | `mistral-large-latest` | `https://api.mistral.ai/v1` | |
| **Groq** | `llama-3.3-70b-versatile` | `https://api.groq.com/openai/v1` | Hosted open models. |
| **Ollama (local)** | `llama3.1` | `http://localhost:11434/v1` | No real key needed, but the resolver requires one to pick the OpenAI-compatible path — set any placeholder (e.g. `MODEL_..._API_KEY=ollama`). |
| **Vercel AI Gateway** | `anthropic/claude-sonnet-5` | **leave blank** | Set `AI_GATEWAY_API_KEY` instead; eve routes the bare model id through the gateway. |

Example `.env` (Anthropic for both roles — the verified working setup):

```dotenv
MODEL_ORCHESTRATOR=claude-haiku-4-5
MODEL_ORCHESTRATOR_BASE_URL=
MODEL_ORCHESTRATOR_API_KEY=sk-ant-...

MODEL_JOB_ANALYST=claude-haiku-4-5
MODEL_JOB_ANALYST_BASE_URL=
MODEL_JOB_ANALYST_API_KEY=sk-ant-...
```

`claude-haiku-4-5` is the recommended default: this agent keeps all
scoring and decisions in deterministic code, so the LLM only does typed
extraction and step sequencing — a small, fast, cheap model is enough.
Upgrade a role to `claude-sonnet-5` only if you see the orchestrator skip
procedure steps or the analyst miss skill nuances.

## Usage

Stage your resume under `agent/sandbox/workspace/inputs/` (or upload it
inline via the API — same `load_input` contract as privacy-classifier),
then send a prompt naming its path and one or more job sources (URLs or
local files staged under `inputs/`):

```
Analyze my resume at inputs/sk-resume-june-2026.pdf against these jobs:
https://job-boards.greenhouse.io/anthropic/jobs/5125387008
https://careers.bain.com/jobs/FolderDetail?folderId=104335
```

One job source → a direct, single model call. More than one → the agent
delegates to a `job-analyst` subagent once per job, each its own eve
session.

## Output

One self-contained JSON file per job under `runs/<timestamp>/`, named
`slug(<job title>)_<timestamp>.json` for a successful analysis or
`slug(<job source>)_<timestamp>.failed.json` when a job source couldn't be
fetched (v1 makes exactly one attempt per source — no retries). Multi-job
runs also get a `ranking.md` ordered by score.

**V1 stops at content generation** — no DOCX, PDF, or HTML file is
produced. Cover-letter content is text inside the JSON
(`cover_letter_text`), optionally rendered through a template staged at
`agent/sandbox/workspace/inputs/templates/cover_letter.txt`.

**Supported resume formats:** PDF (text-based), DOCX, TXT, Markdown.
Scanned image-only PDFs are rejected with a clear error — the pure-Node
extraction path has no OCR (that was a Docling capability, dropped when
extraction moved to Node; see the correction log in
`openspec/changes/add-job-matcher/design.md`). Legacy `.doc` is also not
supported.

## Scoring

The LLM never emits a score. It extracts typed skill matches with
resume-quoted evidence; a deterministic tool (`agent/lib/scoring.ts`)
computes the 100-point breakdown — required skills (40), preferred skills
(20), experience alignment (20), domain alignment (20) — and the match
band (`strong_match` ≥ 80, `good_match` 65–79, `moderate_match` 50–64,
`weak_match` 35–49, `no_match` < 35). This split is also the agent's
prompt-injection defense: a job posting cannot instruct the model to
"report a score of 100," because no code path lets a model output become
a score.

## Roadmap (not built yet)

- **`nextjs-gui/`** — a Next.js + AI SDK front-end, replacing
  talent-align's Streamlit UI. Document rendering (DOCX/PDF/HTML cover
  letters) arrives with this phase; templates already live under
  `inputs/templates/`, waiting.
- **Chat channels** — Slack or Microsoft Teams invocation, the same
  pattern as `linkedin-cover-generator`.

Each is its own future `openspec/changes/<name>/`, walking the same
Inception → Construction → Operations gates as this change did.
