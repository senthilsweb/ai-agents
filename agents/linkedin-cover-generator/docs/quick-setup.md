---
title: Quick Setup
description: Zero-to-first-cover in five steps — install, configure models, start the dev server, generate a cover, find the outputs.
order: 1
updated: 2026-07-05
---

# Quick Setup

Everything here runs from the monorepo; paths are relative to
`agents/linkedin-cover-generator/` unless noted.

## 1. Prerequisites

- **Node 24+** (`nvm use 24`)
- **Docker** running (the sandbox uses `ghcr.io/vercel/eve:latest`)
- API keys for a reasoning model (orchestrator) and an image model

## 2. Install

From the **repo root**:

```bash
nvm use 24
npm install
```

## 3. Configure `.env`

```bash
cd agents/linkedin-cover-generator
cp .env.example .env
```

Minimal working config (Anthropic orchestrator + OpenAI image — the
combination this agent was last verified with):

```dotenv
# Orchestrator — no BASE_URL means the Anthropic provider path is used
MODEL_ORCHESTRATOR=claude-sonnet-5
MODEL_ORCHESTRATOR_API_KEY=sk-ant-...

# Image generation (OpenAI-compatible /images/generations endpoint)
IMAGE_MODEL=gpt-image-2
IMAGE_BASE_URL=https://api.openai.com/v1
IMAGE_API_KEY=sk-...

# Loop control — keep runs bounded
ENABLE_REVIEW=false
MAX_IMAGE_RETRIES=0
RUN_STEP_BUDGET=25
RUN_WALL_CLOCK_BUDGET_S=300

# Cost reporting: absolute path required (the bundled worker cannot
# resolve the rate card relatively). Rates live in shared/cost/rates.yaml.
COST_RATES_FILE=/absolute/path/to/ai-agents/shared/cost/rates.yaml
```

There is **no built-in default model** — an unset role fails at startup by
design. Telemetry and object storage are optional add-ons; see
[Run with Telemetry](./run-with-telemetry.md) and
[Upload Results to Object Store](./upload-results-to-object-store.md).

## 4. Start the dev server

```bash
nvm use 24
npx eve dev --port 3535
```

In a TTY this opens an interactive UI. Headless (CI, another terminal, an
agent driving it), use the HTTP channel directly:

```bash
# start a session
curl -s -X POST http://localhost:3535/eve/v1/session \
  -H "Content-Type: application/json" \
  -d '{"message":"Create a LinkedIn cover from input=inputs/article.md, size=linkedin-article, palette=auto, approval=false."}'
# → {"sessionId":"wrun_...","continuationToken":"eve:..."}

# stream events (NDJSON) until turn.completed
curl -sN http://localhost:3535/eve/v1/session/<sessionId>/stream
```

> **Path note:** `input=inputs/<file>.md` is resolved relative to the
> sandbox workspace (`agent/sandbox/workspace/`) — drop your article into
> `agent/sandbox/workspace/inputs/` and reference it as
> `inputs/<file>.md`, never with an `agents/...` prefix.

## 5. Find the outputs

Each run writes `agent/sandbox/workspace/runs/<UTC-timestamp>/`:

```
cover.png          the generated cover (validated dimensions)
cover-spec.json    the one-pass creative spec
report.md          human-readable run summary
summary.json       machine-readable rollup (tokens, cost, artifacts)
phases/*.json      per-phase traces
```

## Gotchas

- **Never edit `.env` (or any watched file) while a run is in flight** —
  `eve dev` hot-reloads the worker and the in-progress turn stalls
  permanently. Edit between runs; the reload picks changes up
  automatically (watch for the `[telemetry] ...` line to confirm).
- Use `npx eve dev`, not `npm run dev` — the latter can pick up the wrong
  Node version.
- The `summary.json` cost figure sums **every session recorded in the
  machine's tmp usage dir**, not just the current run (pre-existing kit
  behavior).
