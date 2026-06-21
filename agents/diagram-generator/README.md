# Diagram Generator Agent

Turn a description (or a hand-drawn / screenshot **reference**) into a **stunning,
self-contained HTML architecture diagram**. Every run is recorded under a
timestamped `runs/` folder with a metrics report. Built on the
[Vercel Eve](https://vercel.com/eve) agent framework.

This agent lives at `agents/diagram-generator/` in the `ai-agents` monorepo.
All paths below are relative to that folder unless noted.

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

Copy `.env.example` from the repo root to `.env` and fill in your provider:

```bash
cp .env.example .env   # from the repo root
```

Each role (orchestrator, renderer, reporter) can use a different model. The
orchestrator needs strong reasoning (spec analysis, image OCR, layout planning);
the renderer and reporter benefit from a fast, cheap model.

**Recommended: reasoning orchestrator + fast renderer/reporter (z.ai):**

```dotenv
MODEL_ORCHESTRATOR=glm-5.2
MODEL_ORCHESTRATOR_BASE_URL=https://api.z.ai/api/paas/v4/
MODEL_ORCHESTRATOR_API_KEY=your-z-ai-key

MODEL_RENDERER=glm-4.5-air
MODEL_RENDERER_BASE_URL=https://api.z.ai/api/paas/v4/
MODEL_RENDERER_API_KEY=your-z-ai-key

MODEL_REPORTER=glm-4.5-air
MODEL_REPORTER_BASE_URL=https://api.z.ai/api/paas/v4/
MODEL_REPORTER_API_KEY=your-z-ai-key
```

**Simplest: one model for all roles:**

```dotenv
MODEL=deepseek-v4-pro
MODEL_BASE_URL=https://api.deepseek.com
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

(Update `agent/skills/cost_rates.md` with your provider's pricing first.)

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
| `run_root` | `runs` | where the run folder is created |
| `allow_cost` | `false` | compute token cost from the `cost_rates` skill |
| `out_name` | `diagram` | base filename for the HTML |

---

## Model configuration

### Environment variables

Each role reads role-specific env vars that fall back to the generic `MODEL*`
vars. Set these in the root `.env` file.

| Variable | Fallback | Description |
|---|---|---|
| `MODEL_ORCHESTRATOR` | `MODEL` | Model id for the orchestrator |
| `MODEL_ORCHESTRATOR_BASE_URL` | `MODEL_BASE_URL` | API base URL for the orchestrator |
| `MODEL_ORCHESTRATOR_API_KEY` | `MODEL_API_KEY` | API key for the orchestrator |
| `MODEL_RENDERER` | `MODEL` | Model id for the renderer |
| `MODEL_RENDERER_BASE_URL` | `MODEL_BASE_URL` | API base URL for the renderer |
| `MODEL_RENDERER_API_KEY` | `MODEL_API_KEY` | API key for the renderer |
| `MODEL_REPORTER` | `MODEL` | Model id for the reporter |
| `MODEL_REPORTER_BASE_URL` | `MODEL_BASE_URL` | API base URL for the reporter |
| `MODEL_REPORTER_API_KEY` | `MODEL_API_KEY` | API key for the reporter |
| `MODEL_CONTEXT_WINDOW_TOKENS` | `128000` | Context window size for compaction (all roles) |

**If only `MODEL*` is set, all three roles use the same model** (backwards
compatible with the previous single-model architecture).

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
MODEL_ORCHESTRATOR=anthropic/claude-sonnet-4.6
AI_GATEWAY_API_KEY=...
```

---

## Architecture: declared subagents

The renderer and reporter are **declared subagents** under `agent/subagents/`,
each with its own model configuration and isolated Docker sandbox:

```
agent/
├── agent.ts                          # orchestrator (MODEL_ORCHESTRATOR*)
├── instructions.md                   # orchestrator system prompt
├── subagents/
│   ├── renderer/                     # HTML diagram renderer (MODEL_RENDERER*)
│   │   ├── agent.ts
│   │   ├── instructions.md
│   │   ├── skills/                   # design_system, render_diagram
│   │   ├── tools/                    # write_run_file, render_screenshot, ...
│   │   ├── hooks/usage.ts
│   │   └── sandbox/sandbox.ts        # own Docker sandbox
│   └── reporter/                     # metrics report generator (MODEL_REPORTER*)
│       ├── agent.ts
│       ├── instructions.md
│       ├── skills/                   # write_report, cost_rates, report_template
│       ├── tools/                    # write_run_file, read_usage, ...
│       ├── hooks/usage.ts
│       └── sandbox/sandbox.ts        # own Docker sandbox
```

Each subagent has an **isolated sandbox** — it cannot read the orchestrator's
files. The orchestrator passes all context (spec JSON, phase traces) in the
delegation message, and the subagent returns its output (HTML, report content)
in the response.

---

## How it works

The root agent is the **Orchestrator**. On each turn it:

1. **Creates a run folder** — `runs/<UTC-timestamp>/` via the `create_run` tool.
2. **Builds a Diagram Spec** — loads the `build_spec` skill, reads any reference
   image, and writes `spec.json`.
3. **Delegates to the renderer subagent** — calls the `renderer` tool with the
   full spec JSON in the message. The renderer builds a self-contained HTML
   diagram, self-verifies with a headless Playwright screenshot, and returns the
   HTML + phase trace.
4. **Captures token usage** — calls `read_usage` after the renderer returns,
   then records its own phase trace in `phases/orchestrate.json`.
5. **Delegates to the reporter subagent** — calls the `reporter` tool with all
   phase traces + run metadata. The reporter returns `report.md` + `summary.json`
   content.
6. **Prints the run folder, report, and diagram paths.**

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
│   ├── agent.ts                   # orchestrator model config (MODEL_ORCHESTRATOR*)
│   ├── instructions.md            # always-on Orchestrator system prompt
│   ├── lib/
│   │   └── model.ts               # per-role model resolution helper
│   ├── sandbox/
│   │   ├── sandbox.ts             # Docker backend + Playwright bootstrap
│   │   └── workspace/             # seeded into /workspace at session start
│   │       ├── inputs/            #   reference images to port
│   │       └── runs/              #   run outputs (example runs committed)
│   ├── skills/                    # load-on-demand procedures
│   ├── tools/                     # typed executable tools (orchestrator)
│   ├── hooks/usage.ts             # captures step.completed token usage
│   ├── subagents/                 # declared subagents (own model + sandbox)
│   │   ├── renderer/
│   │   └── reporter/
│   └── channels/eve.ts            # the eve HTTP/TUI channel
├── package.json                   # per-agent manifest (eve, ai, zod deps)
└── tsconfig.json                  # per-agent TS config (extends base)
```

---

## Importing shared code

This agent can import cross-agent utilities from the root `shared/` folder via
the `#shared/*` import map:

```typescript
import { getAuthToken } from "#shared/auth/index.js";
```

Agent-private helpers live in `agent/lib/` and are imported via `#lib/*`:

```typescript
import { resolveModel, MODEL_ORCHESTRATOR } from "#lib/model.js";
```

See [`shared/README.md`](../../../shared/README.md) for the shared-code contract.
