# Diagram Generator Agent

Turn a description (or a hand-drawn / screenshot **reference**) into a **stunning,
self-contained HTML architecture diagram**. Every run is recorded under a
timestamped `runs/` folder with a metrics report. Built on the
[Vercel Eve](https://vercel.com/eve) agent framework.

This agent lives at `agents/diagram-generator/` in the `ai-agents` monorepo.
All paths below are relative to that folder unless noted.

> **Design notes:** see [`DESIGN.md`](DESIGN.md) for the architecture,
> determinism boundary, model resolution, and cost-effectiveness decisions.

---

## Prerequisites

- **Node 24+** — Eve requires it. Use `nvm use 24` if you have multiple versions.
- **Docker** — the sandbox uses `ghcr.io/vercel/eve:latest` for headless rendering.
  On Vercel deployments it auto-switches to Vercel Sandbox.
- Network access to `raw.githubusercontent.com` (Lucide icons) and Google Fonts.

---

## Setup

### 1 — Install dependencies

From the **repo root** (installs all workspace agents):

```bash
nvm use 24
npm install
```

Or, to install just this agent's dependencies:

```bash
cd agents/diagram-generator
npm install
```

### 2 — Configure environment variables

Copy `.env.example` to `.env` and fill in your provider:

```bash
cp .env.example .env   # from the agent folder
```

The orchestrator and renderer each resolve their own model (model-agnostic,
env-driven, no built-in default). The orchestrator needs strong reasoning (spec
analysis, image OCR, layout planning); the renderer benefits from a fast, cheap
model. Report assembly is a deterministic tool — there is no reporter model.

**Finalized default (OpenAI):**

```dotenv
MODEL_ORCHESTRATOR=gpt-5.4-mini
MODEL_ORCHESTRATOR_BASE_URL=https://api.openai.com/v1
MODEL_ORCHESTRATOR_API_KEY=your-openai-key

MODEL_RENDERER=gpt-4o-mini
MODEL_RENDERER_BASE_URL=https://api.openai.com/v1
MODEL_RENDERER_API_KEY=your-openai-key
```

**Simplest: one model for all roles:**

```dotenv
MODEL=gpt-5.4-mini
MODEL_BASE_URL=https://api.openai.com/v1
MODEL_API_KEY=sk-your-key-here
```

Any OpenAI-compatible provider works. See the [Model configuration](#model-configuration)
section below for all env vars.

---

## Run in dev mode

From the **repo root**:

```bash
npm run dev
```

This runs `eve dev` inside `agents/diagram-generator/` — an interactive TUI
where you type prompts. The agent orchestrates the full pipeline
(spec → render → report) and prints the run folder path when done.

Or run directly from the agent folder:

```bash
cd agents/diagram-generator
npm run dev
```

### Headless / HTTP API mode

```bash
# Start headless (no TUI) from the agent folder
npx eve dev --no-ui --port 3000 &

# Send a message
curl -X POST http://127.0.0.1:3000/eve/v1/session \
  -H 'content-type: application/json' \
  -d '{"message":"Generate a diagram from inputs/ai-analytics.png, fit=card"}'

# Stream events (NDJSON)
curl http://127.0.0.1:3000/eve/v1/session/<sessionId>/stream
```

See the [Eve sessions & streaming docs](https://beta.eve.dev/docs/concepts/sessions-runs-and-streaming)
for the full API contract.

---

## Test with examples

Reference images live in `agent/sandbox/workspace/inputs/`. Drop a `.png` / `.jpg`
there to port/recreate it, or describe an architecture in words with no reference.

### Example 1 — Port a reference image (keep product names)

```
Generate a diagram. reference=inputs/ai-analytics.png, variations=dark,light,
genericize=false, title="Data Analytics Platform". Run the full procedure: create
the run folder, write spec.json from the image, render each variation per the
design system with a headless self-verify screenshot, then write report.md +
summary.json. Print the output paths when done.
```

### Example 2 — From a description (no reference image)

```
Generate a diagram (no reference image). Build a dark diagram titled
"Event-Driven Order Pipeline" with three zones left-to-right: (1) "Edge" — API
Gateway, Auth; (2) "Core" — Order Service, Payment Service, a Kafka event bus;
(3) "Data" — Postgres, a read-model cache, an analytics warehouse. Animated flow
Edge -> Core -> Data; dashed "events" links from each Core service into Kafka.
genericize=false. Write everything into a runs/<UTC-timestamp>/ folder and print
the paths.
```

### Example 3 — Both themes at once

```
Generate a diagram. reference=inputs/ai-analytics.png, variations=dark,light,
genericize=false. Render both variations into the same runs/<UTC-timestamp>/
folder, self-verify each, then write one report.md covering both. Print the paths.
```

### Example 4 — With token cost in the report

```
Generate a diagram. reference=inputs/ai-analytics.png, fit=card, allow_cost=true.
Print the report path when done.
```

(Populate the shared cost matrix at `shared/cost/rates.yaml` with your provider's
pricing first; unrated models record tokens with cost marked n/a.)

More prompts: see [`example.md`](../../../example.md) at the repo root.

### Committed example runs

Two committed examples live under `agent/sandbox/workspace/runs/`:

1. `runs/2026-06-20T15-14-27Z/` — ports `inputs/ai-analytics.png` into a
   dark-glass architecture diagram with `fit=card`.
2. `runs/2026-06-20T20-14-42Z/` — ports `inputs/jira-to-duckdb.png` with
   `fit=card`. Phase traces include full token usage data.

Browse any `diagram.html` in a browser, or view the `diagram.preview.png`
screenshot.

---

## Prompt options

All options are optional. The agent parses them from your message text.

| Option | Default | Meaning |
|---|---|---|
| `reference` | — | image in `inputs/` to port / recreate |
| `title` / `subtitle` | from image | diagram heading |
| `theme` | `light` | `dark` or `light` |
| `size` | `standard` | `compact` / `standard` / `wide` preset (controls canvas size) |
| `canvas` | — | explicit `WxH`, e.g. `1040x660` (overrides `size`) |
| `fit` | `card` | `card` (bounded, no page break) / `scale` (shrink wide to fit) / `full` (full-page) |
| `variations` | `default` | comma list, e.g. `dark,light` |
| `genericize` | `true` | `false` keeps real product names |
| `spec` | — | path to a prewritten spec JSON (skips spec-building) |
| `allow_cost` | `true` | compute token cost from the shared cost matrix |
| `out_name` | `diagram` | base filename for the HTML |

---

## Model configuration

### Environment variables

Each role resolves `MODEL_<ROLE>_* → MODEL_* →` an explicit startup error (no
built-in default, per ADR 0001 §4). Set these in the agent's `.env` file.

| Variable | Fallback | Description |
|---|---|---|
| `MODEL_ORCHESTRATOR` | `MODEL` | Model id for the orchestrator |
| `MODEL_ORCHESTRATOR_BASE_URL` | `MODEL_BASE_URL` | API base URL for the orchestrator |
| `MODEL_ORCHESTRATOR_API_KEY` | `MODEL_API_KEY` | API key for the orchestrator |
| `MODEL_RENDERER` | `MODEL` | Model id for the renderer |
| `MODEL_RENDERER_BASE_URL` | `MODEL_BASE_URL` | API base URL for the renderer |
| `MODEL_RENDERER_API_KEY` | `MODEL_API_KEY` | API key for the renderer |
| `MODEL_CONTEXT_WINDOW_TOKENS` | `128000` | Context window size for compaction (all roles) |
| `ALLOW_COST` | `true` | Compute cost in `render_and_save_report` |
| `RENDER_MAX_ITERATIONS` | `4` | Renderer self-verify screenshot ceiling |
| `RENDER_WALL_CLOCK_BUDGET_S` | `240` | Per-render wall-clock budget |

**If only `MODEL*` is set, both roles use the same model.** Report assembly is
deterministic (`render_and_save_report`), so there is **no reporter model**.

### Finalized model matrix

| Role | Model | Provider | Notes |
|---|---|---|---|
| Orchestrator | `gpt-5.4-mini` | OpenAI | Reasoning + vision for intake/spec/layout |
| Renderer | `gpt-4o-mini` | OpenAI | Fast, non-reasoning HTML generation; capped iterations |
| Reporter | — | — | Deterministic tool, no model |

### Other configurations

```dotenv
# Different providers per role
MODEL_ORCHESTRATOR=anthropic/claude-sonnet-4.6
MODEL_ORCHESTRATOR_BASE_URL=https://api.anthropic.com
MODEL_ORCHESTRATOR_API_KEY=sk-ant-...

MODEL_RENDERER=gpt-4o-mini
MODEL_RENDERER_BASE_URL=https://api.openai.com/v1
MODEL_RENDERER_API_KEY=sk-...

# Vercel AI Gateway (no base URL needed)
MODEL_ORCHESTRATOR=openai/gpt-5.4-mini
AI_GATEWAY_API_KEY=...
```

---

## Architecture: one declared subagent + deterministic tools

The renderer is a **declared subagent** under `agent/subagents/`, with its own
model configuration and isolated Docker sandbox. Report assembly is the
deterministic `render_and_save_report` tool — not a model.

```
agent/
├── agent.ts                          # orchestrator (MODEL_ORCHESTRATOR*)
├── instructions.md                   # orchestrator system prompt
├── tools/
│   ├── render_and_save_report.ts      # deterministic report.md + summary.json
│   └── sync_run_to_host.ts            # copy the run back to the host
└── subagents/
    └── renderer/                     # HTML diagram renderer (MODEL_RENDERER*)
        ├── agent.ts
        ├── instructions.md           # iteration ceiling + wall-clock budget
        ├── skills/                   # design_system, render_diagram
        ├── tools/                    # write_run_file, render_screenshot, ...
        ├── hooks/usage.ts
        └── sandbox/sandbox.ts        # own Docker sandbox (shared base)
```

The renderer has an **isolated sandbox** — it cannot read the orchestrator's
files. The orchestrator passes all context (spec JSON) in the delegation
message, and the renderer returns its output (HTML, phase trace) in the response.

---

## How it works

The root agent is the **Orchestrator**. On each turn it:

1. **Creates a run folder** — `runs/<UTC-timestamp>/` via the `create_run` tool.
2. **Builds a Diagram Spec** — loads the `build_spec` skill, reads any reference
   image, and writes `spec.json`.
3. **Delegates to the renderer subagent** — calls the `renderer` tool with the
   full spec JSON in the message. The renderer builds a self-contained HTML
   diagram, self-verifies with a headless Playwright screenshot (capped by
   `RENDER_MAX_ITERATIONS`), and returns the HTML + phase trace.
4. **Captures token usage** — calls `read_usage` after the renderer returns,
   then records its own phase trace in `phases/orchestrate.json`.
5. **Assembles the report deterministically** — calls `render_and_save_report`,
   which reads the phase traces + `run-meta.json`, computes timing/token/cost
   metrics (from the shared usage hook + cost matrix), and writes `report.md` +
   `summary.json`. No LLM.
6. **Copies the run to the host** — calls `sync_run_to_host`, which pulls the
   whole run folder (including the binary preview png) back from the sandbox.
7. **Prints the run folder, report, and diagram paths.**

---

## What a run produces

Each run gets its own UTC-timestamped folder under `runs/`:

```
runs/
└── 2026-06-20T15-14-27Z/
    ├── run-meta.json          # request, options, model
    ├── spec.json              # the Diagram Spec
    ├── diagram.html           # the self-contained HTML diagram
    ├── diagram.preview.png    # headless screenshot for QC
    ├── phases/                # per-phase traces (timing / model / tokens)
    │   ├── orchestrate.json
    │   ├── render-default.json
    │   └── report.json
    ├── report.md              # human-readable metrics report
    └── summary.json           # machine-readable rollup
```

---

## Build

```bash
# From the repo root
npm run build

# Or from the agent folder
cd agents/diagram-generator
npm run build
```

## Typecheck

```bash
# From the repo root
npm run typecheck
```

---

## Folder layout

```
agents/diagram-generator/
├── agent/
│   ├── agent.ts                   # orchestrator model config (shared resolveModel)
│   ├── instructions.md            # always-on Orchestrator system prompt
│   ├── sandbox/
│   │   ├── sandbox.ts             # shared base sandbox + Playwright bootstrap
│   │   └── workspace/             # seeded into /workspace at session start
│   │       ├── inputs/            #   reference images to port
│   │       └── runs/              #   run outputs (example runs committed)
│   ├── skills/                    # build_spec, design_system, render_diagram, prompt_template
│   ├── tools/                     # typed executable tools (orchestrator)
│   │   ├── create_run.ts          # make the run folder (shared run)
│   │   ├── write_run_file.ts      # write a text artifact (shared run)
│   │   ├── read_run_file.ts       # read a text artifact
│   │   ├── render_screenshot.ts   # headless QC screenshot
│   │   ├── fetch_lucide_icon.ts   # resolve + inline Lucide icons
│   │   ├── render_and_save_report.ts # deterministic report.md + summary.json
│   │   ├── read_usage.ts          # re-exports the shared usage reader
│   │   └── sync_run_to_host.ts    # re-exports the shared copy-back
│   ├── hooks/usage.ts             # re-exports the shared token-usage hook
│   ├── subagents/                 # declared renderer subagent (own model + sandbox)
│   │   └── renderer/
│   └── channels/eve.ts            # the eve HTTP/TUI channel
├── .env.example                   # per-agent env template (OpenAI matrix)
├── package.json                   # per-agent manifest (eve, ai, zod, shared)
└── tsconfig.json                  # per-agent TS config (extends base)
```

---

## Importing shared code

This agent consumes the shared Agent Runtime Kit (model resolution, run-folder
mirror, usage hook, cost matrix, copy-back, base sandbox) as the `shared`
workspace package:

```typescript
import { resolveModel } from "shared/lib/model.js";
import { writeRunArtifact } from "shared/lib/run.js";
```

Agent-private helpers are imported via `#*` (e.g. `#tools/...`, `#skills/...`).

See [`shared/README.md`](../../../shared/README.md) and
[`openspec/adr/0001-shared-agent-runtime-kit.md`](../../../openspec/adr/0001-shared-agent-runtime-kit.md)
for the shared-kit contract.
