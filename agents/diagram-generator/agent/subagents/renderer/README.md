# Renderer Subagent

The **Renderer** is a declared subagent that produces ONE self-contained HTML
architecture diagram from a Diagram Spec. It is invoked by the orchestrator —
you do not run it directly.

## Role

- Receives the full Diagram Spec JSON inline in the delegation message.
- Builds a fixed-size canvas with absolutely-positioned zones, an SVG "wire"
  layer for connectors, inlined Lucide icons (no emojis), and tasteful motion.
- Self-verifies with a headless Playwright screenshot via `render_screenshot`.
- Returns the full HTML + phase trace in the response so the orchestrator can
  save it to the run folder.

## Model configuration

The renderer reads these env vars (with fallback to the generic `MODEL*` vars),
set in the repo root `.env`:

| Variable | Fallback | Description |
|---|---|---|
| `MODEL_RENDERER` | `MODEL` | Model id |
| `MODEL_RENDERER_BASE_URL` | `MODEL_BASE_URL` | API base URL |
| `MODEL_RENDERER_API_KEY` | `MODEL_API_KEY` | API key |
| `MODEL_RENDERER_CONTEXT_WINDOW_TOKENS` | `MODEL_CONTEXT_WINDOW_TOKENS` | Context window override |

Recommended: a fast, non-reasoning model (e.g. `glm-4.5-air`, `gpt-4o-mini`).
Rendering is execution-heavy, not reasoning-heavy.

## Sandbox

The renderer has its **own isolated Docker sandbox** (`sandbox/sandbox.ts`) — it
cannot read the orchestrator's files. Everything it needs arrives in the
delegation message. It writes output to its own sandbox, then returns the content
in the response.

The sandbox bootstraps Playwright + Chromium once per template (cached by
`revalidationKey`) so the self-verify screenshot works.

## Files

- `agent.ts` — model config (reads `MODEL_RENDERER*` env vars)
- `instructions.md` — renderer system prompt
- `skills/` — `design_system`, `render_diagram`
- `tools/` — `write_run_file`, `read_run_file`, `fetch_lucide_icon`,
  `render_screenshot`, `read_usage`
- `hooks/usage.ts` — captures `step.completed` token usage (own copy)
- `sandbox/sandbox.ts` — Docker backend + Playwright bootstrap

## How to test

You don't invoke the renderer directly. Instead, run the orchestrator in dev mode
and send a prompt — the orchestrator delegates to the renderer automatically:

```bash
# From the repo root
npm run dev
```

Then paste a prompt like:

```
Generate a diagram. reference=inputs/ai-analytics.png, fit=card, genericize=false.
```

The orchestrator's delegation message to the renderer includes the full spec JSON.
To inspect what the renderer received and returned, look at
`phases/render-default.json` in the run output folder.
