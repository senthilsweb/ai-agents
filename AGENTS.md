# Diagram Generator — Vercel Eve Agent

This project is an [eve](https://vercel.com/eve) agent that generates stunning,
self-contained HTML architecture diagrams and records each run under a
timestamped `runs/` folder with a metrics report. It lives under
`agents/diagram-generator/` in the `ai-agents` monorepo.

Before writing code, read the relevant guide in `node_modules/eve/docs/`.

## Surface

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

## Conventions

- The renderer and reporter run as **copies of the agent** (built-in `agent`
  tool) so they share the `runs/` folder. Do not declare separate subagents for
  them.
- Add agent-private helpers under `agent/lib/` (import-only, never mounted).
  Cross-agent shared code lives in the root `shared/` folder (import via
  `#shared/*`).
- Skills are scoped per agent; copy markdown under each agent that needs it.
- Output is always one standalone HTML file: inlined Lucide icons (no emojis),
  Google Fonts with fallbacks, editable plain text.
- Run `eve` commands from `agents/diagram-generator/` (e.g. `cd agents/diagram-generator && npm run dev`).
