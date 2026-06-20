# Diagram Generator — Vercel Eve Agent

Turn a description (or a hand-drawn / screenshot **reference**) into a **stunning,
self-contained HTML architecture diagram**, and record every run under a
timestamped `runs/` folder with a metrics report. Built on the [Vercel Eve]
(https://vercel.com/eve) agent framework — the agent reads its procedures from
markdown **skills** and drives real work through typed **tools**.

## How it works

The root agent is the **Orchestrator**. On each turn it:

1. Calls `create_run` to make a timestamped `runs/<UTC-timestamp>/` folder.
2. Loads the `build_spec` skill and converts the request (and/or a reference
   image) into a Diagram Spec (`spec.json`).
3. Fans out one **renderer** copy per variation via the built-in `agent` tool —
   each loads `render_diagram` + `design_system`, builds one self-contained HTML
   diagram, and self-verifies with a headless screenshot.
4. Records its own phase trace.
5. Delegates to a **reporter** copy (loads `write_report`) that aggregates the
   phase traces into `report.md` + `summary.json`.
6. Prints the run folder, report, and diagram paths.

The renderer and reporter run as **copies of the agent** (Eve's built-in `agent`
tool) so they share the sandbox and `runs/` folder — that shared filesystem is
what makes parallel fan-out work.

## Folder layout

```
agent-diagram-generator/
├── agent/                         # the eve agent
│   ├── agent.ts                   # model + compaction config
│   ├── instructions.md            # always-on Orchestrator system prompt
│   ├── sandbox/
│   │   ├── sandbox.ts             # Docker backend + Playwright bootstrap
│   │   └── workspace/             # seeded into /workspace at session start
│   │       ├── inputs/            #   reference images to port
│   │       └── runs/              #   run outputs (committed history)
│   ├── skills/                    # load-on-demand procedures (the playbooks)
│   │   ├── design_system.md       #   visual + technical contract
│   │   ├── build_spec.md          #   spec schema + phase-trace schema
│   │   ├── render_diagram.md      #   renderer procedure
│   │   ├── write_report.md        #   reporter procedure
│   │   ├── cost_rates.md          #   token cost rate-card
│   │   ├── report_template.md     #   markdown report template
│   │   └── prompt_template.md     #   single-diagram prompt scaffold
│   ├── tools/                     # typed executable tools (run in app runtime)
│   │   ├── create_run.ts          #   make the timestamped run folder
│   │   ├── write_run_file.ts      #   write an artifact into a run
│   │   ├── read_run_file.ts       #   read a run artifact
│   │   ├── fetch_lucide_icon.ts   #   fetch + inline a Lucide icon
│   │   └── render_screenshot.ts   #   headless Playwright self-verify
│   └── channels/eve.ts            # the eve HTTP/TUI channel
├── example.md                     # ready-to-paste prompts
├── package.json                   # eve, ai, zod deps (Node 24)
└── README.md                      # this file
```

## Requirements

- **Node 24+** (eve requirement). Use `nvm use 24` if you have multiple versions.
- A **sandbox backend** for headless rendering. The default config uses Docker
  (`ghcr.io/vercel/eve:latest`); on Vercel it auto-switches to Vercel Sandbox.
  The sandbox bootstrap installs Playwright + Chromium so the self-verify
  screenshot works.
- Network to `raw.githubusercontent.com` (Lucide icons) and Google Fonts.

## Run it

```bash
nvm use 24            # ensure Node 24+
npm install           # first time only
npm run dev           # starts `eve dev` (interactive TUI + HTTP channel)
```

Then send a prompt (see `example.md`). The simplest:

```
Generate a diagram. reference=inputs/ai-analytics.png, genericize=false,
title="Data Analytics Platform". Run the full procedure and print the paths.
```

Or describe an architecture in words with no reference image.

## Inputs — how reference images work

`agent/sandbox/workspace/inputs/` holds the picture you want the harness to
**port / recreate**: a phone photo of a whiteboard, a screenshot of a slide, a
draw.io export, anything visual.

- **Add a file:** drop a `.png` / `.jpg` into `agent/sandbox/workspace/inputs/`.
- **Use it:** pass `reference=inputs/<file>` in your prompt. The orchestrator
  reads it as the source of truth for zones, order, and relationships, then
  rebuilds it in the dark glass style.
- **Fidelity vs. style:** it matches *structure, labels, and flow* faithfully and
  elevates the look, using tasteful **Lucide icons** (never brand logos). With
  `genericize=false`, product *names* are kept as labels.
- **No input needed:** run with no `reference` and just describe the
  architecture — the orchestrator builds the spec from your description.

## What a run produces

Each run gets its own UTC-timestamped folder under `runs/`:

```
runs/
└── 2026-06-09T14-30-00Z/
    ├── run-meta.json          # request, options, models
    ├── spec.json              # the Diagram Spec used
    ├── diagram-dark.html      # result per variation (or diagram.html for default)
    ├── diagram-dark.preview.png
    ├── phases/                # per-phase traces (timing / model / tokens)
    ├── report.md              # human-readable metrics report
    └── summary.json           # machine-readable rollup
```

Commit `runs/` so your diagram history + metrics are preserved.

## Options (passed in the prompt)

| Option | Default | Meaning |
|---|---|---|
| `reference` | — | image in `inputs/` to port |
| `title` / `subtitle` | from image | diagram heading |
| `theme` | `dark` | `dark` or `light` |
| `size` | `standard` | `compact` / `standard` / `wide` preset (controls canvas size) |
| `canvas` | — | explicit `WxH`, e.g. `1040x660` (overrides `size`) |
| `variations` | `default` | comma list, e.g. `dark,light` |
| `genericize` | `true` | `false` keeps real product names |
| `spec` | — | path to a prewritten spec JSON (skips spec-building) |
| `run_root` | `runs` | where the run folder is created |
| `allow_cost` | `false` | compute token cost from `cost_rates` |
| `out_name` | `diagram` | base filename for the HTML |

## Controlling diagram size

By default the diagram fills the browser window. Two approaches:

**A. Smaller canvas (re-laid out, stays crisp) — recommended.** The renderer
fits the same content into a smaller box and scales fonts/padding. Use the `size`
preset or an explicit `canvas`:

| `size` | Canvas (≈) | Use for |
|---|---|---|
| `compact` | `1040 × 660` | a small, embeddable diagram |
| `standard` | `1280 × 800` | a balanced default |
| `wide` | `1480 × 1000` | dense, many-zone diagrams |

Example: `size=compact`, or `canvas=1040x660`.

**B. Scale-to-fit (keep the layout, just shrink it) — good for embedding.** Keeps
the proportions but wraps the canvas so it scales to a `max-width` as a bounded
card. Ask for: *"keep the layout but wrap the canvas to scale to max-width 900px,
transform-origin top-left, and remove min-height:100vh so it's a bounded box."*

## Metrics: what's captured (honest caveats)

- **Execution time** — always captured (wall-clock UTC per phase + total).
- **Token consumption** — captured **only when your runtime exposes usage** to
  the agent (or you drop a `usage.json` in the run folder). Otherwise the report
  prints `n/a` with a note — timing only.
- **Token cost** — computed only with `allow_cost=true`, from the `cost_rates`
  skill (placeholder rates — update them). Unknown model → cost `n/a`.

## Migrating from the old harness

This repo previously used a manual Copilot-CLI playbook flow (markdown agents
under `agents/` invoked by "Run agents/orchestrator.md"). That has been replaced
by the Eve agent above. The procedures, design system, templates, and cost
rate-card were preserved verbatim as Eve **skills**, and the shell steps the old
agent ran by hand are now typed **tools**. See `example.md` for the new prompt
shape.
