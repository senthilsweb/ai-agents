# Reporter Subagent

The **Reporter** is a declared subagent that aggregates a run's phase traces into
a `report.md` and `summary.json` with timing, token, and cost metrics. It is
invoked by the orchestrator — you do not run it directly.

## Role

- Receives all phase trace JSON + run metadata inline in the delegation message.
- Computes per-phase and total wall-clock timing (accounting for parallel
  renderers via `max(ended_at) - min(started_at)`).
- Sums token usage across phases where `tokens.source == "runtime"`.
- Optionally computes token cost (when `allow_cost=true`) using the `cost_rates`
  skill.
- Returns the full `report.md` + `summary.json` content in the response so the
  orchestrator can save them to the run folder.

## Model configuration

The reporter reads these env vars (with fallback to the generic `MODEL*` vars),
set in the repo root `.env`:

| Variable | Fallback | Description |
|---|---|---|
| `MODEL_REPORTER` | `MODEL` | Model id |
| `MODEL_REPORTER_BASE_URL` | `MODEL_BASE_URL` | API base URL |
| `MODEL_REPORTER_API_KEY` | `MODEL_API_KEY` | API key |
| `MODEL_REPORTER_CONTEXT_WINDOW_TOKENS` | `MODEL_CONTEXT_WINDOW_TOKENS` | Context window override |

Recommended: a fast, cheap model (e.g. `glm-4.5-air`, `gpt-4o-mini`). Reporting
is aggregation, not reasoning.

## Sandbox

The reporter has its **own isolated Docker sandbox** (`sandbox/sandbox.ts`) — it
cannot read the orchestrator's files. All phase traces and run metadata arrive in
the delegation message. It returns the report content in the response.

## Files

- `agent.ts` — model config (reads `MODEL_REPORTER*` env vars)
- `instructions.md` — reporter system prompt
- `skills/` — `write_report`, `cost_rates`, `report_template`
- `tools/` — `write_run_file`, `read_run_file`, `read_usage`
- `hooks/usage.ts` — captures `step.completed` token usage (own copy)
- `sandbox/sandbox.ts` — Docker backend

## How to test

You don't invoke the reporter directly. Instead, run the orchestrator in dev mode
and send a prompt — the orchestrator delegates to the reporter after the renderer
returns:

```bash
# From the repo root
npm run dev
```

Then paste a prompt like:

```
Generate a diagram. reference=inputs/ai-analytics.png, fit=card, allow_cost=true.
```

To inspect what the reporter produced, look at `report.md` and `summary.json` in
the run output folder. To update cost rates, edit
`skills/cost_rates.md` (and the orchestrator's copy at
`../../skills/cost_rates.md`).
