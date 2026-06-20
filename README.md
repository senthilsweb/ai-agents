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

### 3 — Configure the model

Copy `.env.example` to `.env` and fill in your provider:

```bash
cp .env.example .env
```

```dotenv
# .env — defaults shown (DeepSeek)
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
Generate a standard-size diagram from reference=inputs/ai-analytics.png,
fit=card, genericize=false, title="AI Analytics Platform".
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
| `theme` | `dark` | `dark` or `light` |
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

## Model configuration

The model is set via `.env` — no code changes needed to switch providers.

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `MODEL` | `deepseek-v4-pro` | Model id your provider expects |
| `MODEL_BASE_URL` | `https://api.deepseek.com` | OpenAI-compatible API base URL |
| `MODEL_API_KEY` | — | Provider API key (also reads `DEEPSEEK_API_KEY` / `AI_GATEWAY_API_KEY` as aliases) |
| `MODEL_CONTEXT_WINDOW_TOKENS` | `128000` | Context window size for compaction (override if your model differs) |

### Supported providers

Any OpenAI-compatible endpoint works:

```dotenv
# DeepSeek (default)
MODEL=deepseek-v4-pro
MODEL_BASE_URL=https://api.deepseek.com
MODEL_API_KEY=sk-...

# OpenRouter
MODEL=anthropic/claude-sonnet-4.6
MODEL_BASE_URL=https://openrouter.ai/api/v1
MODEL_API_KEY=sk-or-...

# OpenAI
MODEL=gpt-4o
MODEL_BASE_URL=https://api.openai.com/v1
MODEL_API_KEY=sk-...

# Vercel AI Gateway (no base URL needed)
MODEL=anthropic/claude-sonnet-4.6
AI_GATEWAY_API_KEY=...
```

> **Note:** The orchestrator, renderer, and reporter all run as copies of the
> same agent (Eve's built-in `agent` tool), so they share one model
> configuration. Per-subagent model overrides are not supported in this
> architecture — the shared sandbox + `runs/` folder requires copy-of-self
> delegation.

---

## How it works

The root agent is the **Orchestrator**. On each turn it:

1. **Creates a run folder** — `runs/<UTC-timestamp>/` via the `create_run` tool.
2. **Builds a Diagram Spec** — loads the `build_spec` skill, reads any reference image, and writes `spec.json`.
3. **Fans out renderers** — one copy of the agent per variation via the built-in `agent` tool. Each loads `render_diagram` + `design_system`, builds a self-contained HTML diagram, and self-verifies with a headless Playwright screenshot.
4. **Records its own phase trace** — `phases/orchestrate.json`.
5. **Delegates to a reporter** — another agent copy loads `write_report`, aggregates phase traces, and writes `report.md` + `summary.json`.
6. **Prints the run folder, report, and diagram paths.**

The renderer and reporter run as **copies of the agent** so they share the sandbox and `runs/` folder — that shared filesystem is what makes fan-out work.

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

### Example run

A committed example lives at
[`runs/2026-06-20T15-14-27Z/`](agent/sandbox/workspace/runs/2026-06-20T15-14-27Z/) —
it ports `inputs/ai-analytics.png` into a dark-glass architecture diagram with
`fit=card`. Browse the `diagram.html` in a browser, or view the
[`diagram.preview.png`](agent/sandbox/workspace/runs/2026-06-20T15-14-27Z/diagram.preview.png)
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
│   ├── agent.ts                   # model + compaction config (env-driven)
│   ├── instructions.md            # always-on Orchestrator system prompt
│   ├── sandbox/
│   │   ├── sandbox.ts             # Docker backend + Playwright bootstrap
│   │   └── workspace/             # seeded into /workspace at session start
│   │       ├── inputs/            #   reference images to port
│   │       └── runs/              #   run outputs (example run committed)
│   ├── skills/                    # load-on-demand procedures
│   │   ├── design_system.md       #   visual + technical contract
│   │   ├── build_spec.md          #   spec schema + phase-trace schema
│   │   ├── render_diagram.md      #   renderer procedure
│   │   ├── write_report.md        #   reporter procedure
│   │   ├── cost_rates.md          #   token cost rate-card
│   │   ├── report_template.md     #   markdown report template
│   │   └── prompt_template.md     #   single-diagram prompt scaffold
│   ├── tools/                     # typed executable tools
│   │   ├── create_run.ts          #   make the timestamped run folder
│   │   ├── write_run_file.ts      #   write an artifact into a run
│   │   ├── read_run_file.ts       #   read a run artifact
│   │   ├── fetch_lucide_icon.ts   #   fetch + inline a Lucide icon
│   │   └── render_screenshot.ts   #   headless Playwright self-verify
│   └── channels/eve.ts            # the eve HTTP/TUI channel
├── .env.example                   # model config template
├── example.md                     # ready-to-paste prompts
├── package.json                   # eve, ai, zod deps (Node 24)
└── README.md                      # this file
```

---

## Metrics

- **Execution time** — always captured (wall-clock UTC per phase + total).
- **Token consumption** — captured when the runtime exposes usage to the agent. Otherwise the report prints `n/a` with a note.
- **Token cost** — computed only with `allow_cost=true`, from the `cost_rates` skill. Rates are placeholders — update them to match your provider.

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
