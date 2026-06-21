# Diagram Generator — Vercel Eve Agent

Turn a description (or a hand-drawn / screenshot **reference**) into a **stunning,
self-contained HTML architecture diagram**. Every run is recorded under a
timestamped `runs/` folder with a metrics report. Built on the [Vercel Eve](https://vercel.com/eve) agent framework — procedures live in markdown **skills** and real work happens through typed **tools**.

---

## Quickstart

### 1 — Prerequisites

- **Node 24+** — Eve requires it. Use `nvm use 24` if you have multiple versions.
- **Docker** — the sandbox uses `ghcr.io/vercel/eve:latest` for headless rendering. On Vercel deployments it auto-switches to Vercel Sandbox.
- Network access to `raw.githubusercontent.com` (Lucide icons) and Google Fonts.

### 2 — Install

```bash
nvm use 24
npm install
```

### 3 — Configure the models

Copy `.env.example` to `.env` and fill in your provider. Each role
(orchestrator, renderer, reporter) can use a different model:

```bash
cp .env.example .env
```

```dotenv
# .env — recommended: reasoning orchestrator + fast renderer (z.ai)
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

Or use a single model for all roles (simplest):

```dotenv
MODEL=deepseek-v4-pro
MODEL_BASE_URL=https://api.deepseek.com
MODEL_API_KEY=sk-your-key-here
```

Any OpenAI-compatible provider works — see **Model configuration** below.

### 4 — Run

```bash
npm run dev
```

This starts `eve dev` — an interactive TUI where you type prompts. The agent
orchestrates the full pipeline (spec → render → report) and prints the run
folder path when done.

### 5 — Your first prompt

```
Generate a standard-size diagram from reference=inputs/jira-to-duckdb.png,
fit=card, genericize=false, title="Jira to DuckDB Pipeline".
```

Or describe an architecture in words with no reference image:

```
Generate a wide diagram of a 3-tier web app: ALB → ECS services → RDS + ElastiCache.
```

---

## Options (passed in the prompt)

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

## Canvas size & fit

Diagrams used to always fill the full browser window (`min-height: 100vh`),
which caused page breaks and awkward stretching. Two controls fix this:

### Size presets (`size`)

Controls the canvas dimensions — content is re-laid out to fit:

| `size` | Canvas (approx) | Good for |
|---|---|---|
| `compact` | `1040 × 660` | a small, embeddable diagram |
| `standard` | `1280 × 800` | a balanced default |
| `wide` | `1480 × 1000` | dense, many-zone diagrams |

Use an explicit `canvas=1040x660` to override the preset.

### Page fit (`fit`)

Controls how the canvas sits on the page:

| `fit` | Behaviour |
|---|---|
| `card` | **Default.** Canvas is wrapped in a centered, bounded card. No `100vh`. Prevents page breaks — use for PDFs and screenshots. |
| `scale` | Keeps a wide canvas layout but scales it down to a `max-width`. Good for embedding a large diagram in a smaller container. |
| `full` | Full-page (the old behaviour). Opt-in only — use when you want the diagram to fill the viewport. |

**Example:** `size=compact, fit=card` → a small, bounded diagram that won't break across pages.

---

## Model configuration — per-role model selection

The orchestrator, renderer, and reporter each run as **separate declared
subagents** with their own model configuration. This lets you use a strong
reasoning model for orchestration (spec analysis, layout planning) and a fast,
cheap model for rendering and reporting (execution-heavy, not reasoning-heavy).

### Environment variables

Each role reads role-specific env vars that fall back to the generic `MODEL*`
vars:

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

### Recommended: reasoning orchestrator + fast renderer

A reasoning model (e.g. GLM-5.2, Claude Sonnet) excels at spec analysis and
layout planning but can loop indefinitely on rendering. A fast non-reasoning
model (e.g. GLM-4.5-Air, GPT-4o-mini) handles rendering efficiently.

```dotenv
# .env — reasoning orchestrator + fast renderer/reporter (z.ai)
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

### Other configurations

```dotenv
# Same model for all roles (simplest)
MODEL=deepseek-v4-pro
MODEL_BASE_URL=https://api.deepseek.com
MODEL_API_KEY=sk-...

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

### Architecture: declared subagents

The renderer and reporter are **declared subagents** under `agent/subagents/`:

```
agent/
├── agent.ts                          # orchestrator (MODEL_ORCHESTRATOR*)
├── instructions.md                   # orchestrator system prompt
├── subagents/
│   ├── renderer/
│   │   ├── agent.ts                  # renderer (MODEL_RENDERER*)
│   │   ├── instructions.md           # renderer system prompt
│   │   ├── skills/                   # design_system, render_diagram
│   │   ├── tools/                    # write_run_file, render_screenshot, ...
│   │   ├── hooks/usage.ts            # token capture (own copy)
│   │   └── sandbox/sandbox.ts        # own Docker sandbox
│   └── reporter/
│       ├── agent.ts                  # reporter (MODEL_REPORTER*)
│       ├── instructions.md           # reporter system prompt
│       ├── skills/                   # write_report, cost_rates, report_template
│       ├── tools/                    # write_run_file, read_usage, ...
│       ├── hooks/usage.ts            # token capture (own copy)
│       └── sandbox/sandbox.ts        # own Docker sandbox
```

Each subagent has an **isolated sandbox** — it cannot read the orchestrator's
files. The orchestrator passes all context (spec JSON, phase traces) in the
delegation message, and the subagent returns its output (HTML, report content)
in the response. The orchestrator writes the returned content to the run folder.

---

## How it works

The root agent is the **Orchestrator**. On each turn it:

1. **Creates a run folder** — `runs/<UTC-timestamp>/` via the `create_run` tool.
2. **Builds a Diagram Spec** — loads the `build_spec` skill, reads any reference image, and writes `spec.json`.
3. **Delegates to the renderer subagent** — calls the `renderer` tool with the full spec JSON in the message. The renderer (running its own model) builds a self-contained HTML diagram, self-verifies with a headless Playwright screenshot, and returns the HTML + phase trace. The orchestrator writes the returned HTML to the run folder.
4. **Captures token usage** — calls `read_usage` after the renderer returns to get its token consumption, then records its own phase trace in `phases/orchestrate.json`.
5. **Delegates to the reporter subagent** — calls the `reporter` tool with all phase traces + run metadata in the message. The reporter aggregates metrics and returns `report.md` + `summary.json` content. The orchestrator writes them to the run folder.
6. **Prints the run folder, report, and diagram paths.**

The renderer and reporter are **declared subagents** with isolated sandboxes.
Each runs its own model (configured via `MODEL_RENDERER*` / `MODEL_REPORTER*`
env vars). The orchestrator passes all context in the delegation message and
writes returned content to the shared run folder.

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

### Example runs

Two committed examples live under `runs/`:

1. [`runs/2026-06-20T15-14-27Z/`](agent/sandbox/workspace/runs/2026-06-20T15-14-27Z/) —
   ports `inputs/ai-analytics.png` into a dark-glass architecture diagram with
   `fit=card`.

2. [`runs/2026-06-20T20-14-42Z/`](agent/sandbox/workspace/runs/2026-06-20T20-14-42Z/) —
   ports `inputs/jira-to-duckdb.png` with `fit=card`. Phase traces include
   full token usage data captured by the usage hook.

Browse any `diagram.html` in a browser, or view the `diagram.preview.png`
screenshot.

---

## Inputs — reference images

`agent/sandbox/workspace/inputs/` holds pictures you want the agent to **port /
recreate**: a phone photo of a whiteboard, a screenshot of a slide, a draw.io
export — anything visual.

- **Add a file:** drop a `.png` / `.jpg` into `agent/sandbox/workspace/inputs/`.
- **Use it:** pass `reference=inputs/<file>` in your prompt. The orchestrator reads it as the source of truth for zones, order, and relationships, then rebuilds it in the dark glass style.
- **Fidelity vs. style:** it matches *structure, labels, and flow* faithfully and elevates the look, using tasteful **Lucide icons** (never brand logos). With `genericize=false`, product *names* are kept as labels.
- **No input needed:** run with no `reference` and just describe the architecture.

---

## Folder layout

```
agent-diagram-generator/
├── agent/                         # the eve agent
│   ├── agent.ts                   # orchestrator model config (MODEL_ORCHESTRATOR*)
│   ├── instructions.md            # always-on Orchestrator system prompt
│   ├── shared/
│   │   └── model.ts               # per-role model resolution helper
│   ├── sandbox/
│   │   ├── sandbox.ts             # Docker backend + Playwright bootstrap
│   │   └── workspace/             # seeded into /workspace at session start
│   │       ├── inputs/            #   reference images to port
│   │       └── runs/              #   run outputs (example runs committed)
│   ├── skills/                    # load-on-demand procedures
│   │   ├── design_system.md       #   visual + technical contract
│   │   ├── build_spec.md          #   spec schema + phase-trace schema
│   │   ├── render_diagram.md      #   renderer procedure (reference)
│   │   ├── write_report.md        #   reporter procedure (reference)
│   │   ├── cost_rates.md          #   token cost rate-card
│   │   ├── report_template.md     #   markdown report template
│   │   └── prompt_template.md     #   single-diagram prompt scaffold
│   ├── tools/                     # typed executable tools (orchestrator)
│   │   ├── create_run.ts          #   make the timestamped run folder
│   │   ├── write_run_file.ts      #   write an artifact into a run
│   │   ├── read_run_file.ts       #   read a run artifact
│   │   ├── read_usage.ts          #   read accumulated token usage
│   │   ├── fetch_lucide_icon.ts   #   fetch + inline a Lucide icon
│   │   └── render_screenshot.ts   #   headless Playwright self-verify
│   ├── hooks/
│   │   └── usage.ts               #   captures step.completed token usage
│   ├── subagents/                 # declared subagents (own model + sandbox)
│   │   ├── renderer/              #   HTML diagram renderer
│   │   │   ├── agent.ts           #   MODEL_RENDERER* config
│   │   │   ├── instructions.md    #   renderer system prompt
│   │   │   ├── skills/            #   design_system + render_diagram
│   │   │   ├── tools/             #   write_run_file, render_screenshot, ...
│   │   │   ├── hooks/usage.ts     #   token capture (own copy)
│   │   │   └── sandbox/sandbox.ts #   own Docker sandbox
│   │   └── reporter/              #   metrics report generator
│   │       ├── agent.ts           #   MODEL_REPORTER* config
│   │       ├── instructions.md    #   reporter system prompt
│   │       ├── skills/            #   write_report, cost_rates, report_template
│   │       ├── tools/             #   write_run_file, read_usage, ...
│   │       ├── hooks/usage.ts     #   token capture (own copy)
│   │       └── sandbox/sandbox.ts #   own Docker sandbox
│   └── channels/eve.ts            # the eve HTTP/TUI channel
├── .env.example                   # per-role model config template
├── example.md                     # ready-to-paste prompts
├── package.json                   # eve, ai, zod deps (Node 24)
└── README.md                      # this file
```

---

## Metrics & observability

### Execution time

Always captured — wall-clock UTC per phase + total, written to each phase trace
and the final report.

### Token consumption

Captured automatically by a **usage hook** (`agent/hooks/usage.ts`) that listens
to `step.completed` stream events. Each step carries `usage.inputTokens`,
`usage.outputTokens`, `usage.cacheReadTokens`, and `usage.cacheWriteTokens`.

The hook accumulates per-session usage in the OS temp directory
(`$TMPDIR/eve-usage/<sessionId>.json`). The orchestrator calls the `read_usage`
tool after each subagent returns and before the reporter, writing the token data
into phase traces with `"source": "runtime"`.

Because the orchestrator, renderer, and reporter are **declared subagents**
(each with its own session), the usage hook fires for every session —
orchestrator, renderer, and reporter alike. Each subagent has its own copy of
the hook in `agent/subagents/<id>/hooks/usage.ts`.

### Token cost

Computed only with `allow_cost=true`, from the `cost_rates` skill. Rates are
placeholders — update them to match your provider.

### Example phase trace (with token data)

```json
{
  "phase": "orchestrate",
  "model": "deepseek-v4-pro",
  "started_at": "2026-06-20T20:14:42Z",
  "ended_at": "2026-06-20T20:41:00Z",
  "duration_s": 1578,
  "tokens": {
    "input": 741265,
    "output": 31055,
    "cacheRead": 714880,
    "total": 772320,
    "source": "runtime"
  }
}
```

---

## Non-interactive usage

The dev server exposes an HTTP API for scripts and automation:

```bash
# Start headless (no TUI)
npx eve dev --no-ui --port 3000 &

# Send a message
curl -X POST http://127.0.0.1:3000/eve/v1/session \
  -H 'content-type: application/json' \
  -d '{"message":"Generate a diagram from inputs/ai-analytics.png, fit=card"}'

# Stream events (NDJSON)
curl http://127.0.0.1:3000/eve/v1/session/<sessionId>/stream
```

See the [Eve sessions & streaming docs](https://beta.eve.dev/docs/concepts/sessions-runs-and-streaming) for the full API contract.
