# Design: Adopt the Shared Runtime Kit and Rebalance the Diagram Generator

> Conforms to [`ai-agents/openspec/adr/0001-shared-agent-runtime-kit.md`](../../../../../../openspec/adr/0001-shared-agent-runtime-kit.md)
> and [`ai-agents/openspec/adr/0002-cost-matrix.md`](../../../../../../openspec/adr/0002-cost-matrix.md).

## 1. Deterministic vs. LLM boundary

```
intake/spec ── LLM (orchestrator, bounded) ──┐
                                             ├─► spec.json ──► renderer (LLM, fast, capped)
reference image ─────────────────────────────┘                     │
                                                                    ▼
                                            screenshot QC (tool) ◄── HTML
                                                                    │
phase traces ──► render_and_save_report (TOOL) ──► report.md + summary.json
                                                                    │
                                                  sync_run_to_host (TOOL) ──► host
```

- **LLM, bounded**: orchestrator (spec authoring, image OCR, layout planning)
  and renderer (HTML art-direction). Both are generative judgement and stay on
  the model — but capped by model class, a step/turn ceiling, and a wall-clock
  budget so neither can loop indefinitely.
- **Deterministic tools**: `create_run`, `write_run_file`, `read_run_file`,
  `render_screenshot` (QC), `read_usage`, `render_and_save_report` (new),
  `sync_run_to_host`. These are the "simple, deterministic items" the user
  wants tools restricted to.

## 2. Model matrix (GPT/OpenAI default)

| Env var | Default | Provider | Class | Role |
|---------|---------|----------|-------|------|
| `MODEL_ORCHESTRATOR` | `gpt-5.4-mini` | `https://api.openai.com/v1` | reasoning (light) + vision | spec/intake |
| `MODEL_RENDERER` | `gpt-4o-mini` | `https://api.openai.com/v1` | fast, non-reasoning | HTML generation |
| `IMAGE_MODEL` | `gpt-image-2` | `https://api.openai.com/v1` | image | optional rasterized preview |
| (reporter) | — | — | none | deterministic tool |

Resolution per ADR 0001 §4: `MODEL_<ROLE>_* → MODEL_* →` **throw** (no default
baked into code; the `.env.example` supplies the recommended ids).

## 3. File-by-file impact

### Replaced / removed
- `agent/lib/model.ts` → **deleted**. Replaced by `shared/lib/model.js`. Removes
  the forbidden `deepseek-v4-pro` hard-coded default.
- `agent/subagents/reporter/**` → **deleted** (LLM reporter retired).
- `agent/skills/write_report.md`, `agent/skills/report_template.md`,
  `agent/skills/cost_rates.md` → **deleted** (logic moves to the report tool +
  `shared/cost/rates.yaml`).
- Duplicated `read_usage.ts` copies under the agent and renderer subagent →
  re-exports of `shared/tools/read_usage.js`.

### Added
- `agent/tools/render_and_save_report.ts` — deterministic: reads
  `phases/*.json` + `run-meta.json`, calls `buildRunSummary` (shared), writes
  `report.md` + `summary.json`. No LLM.
- `agent/tools/sync_run_to_host.ts` — `export { default } from "shared/tools/sync_run_to_host.js"`.
- `agent/hooks/usage.ts` — `export { default } from "shared/hooks/usage.js"`.
- `agent/tools/read_usage.ts` — `export { default } from "shared/tools/read_usage.js"`.
- `.env.example` — new, OpenAI-default model matrix + budget vars.

### Modified
- `package.json` — add `"shared": "*"`; drop `#shared/*` and `#lib/model.js`
  from `imports`.
- `agent/agent.ts` — `resolveModel("orchestrator", { providerName: "diagram-generator-orchestrator" })`.
- `agent/subagents/renderer/agent.ts` — `resolveModel("renderer", …)`; keep
  isolated sandbox; document iteration cap.
- `agent/instructions.md` — replace the "delegate to reporter subagent" steps
  (§5) with "call `render_and_save_report`"; add `sync_run_to_host` as the final
  step; state the renderer iteration ceiling and wall-clock budget; remove
  reporter language.
- `agent/sandbox/sandbox.ts` + `renderer/sandbox/sandbox.ts` — extend
  `createBaseSandbox()` from `shared/sandbox/base-sandbox.js`.
- `README.md` — model configuration section → OpenAI matrix; remove reporter
  subagent from the architecture description.

## 4. Guardrails

- Renderer: `RENDER_MAX_ITERATIONS` (default 4 screenshot retries) + per-render
  wall-clock budget; on exceed, record `qc.passed: false` and continue.
- Orchestrator: `RUN_STEP_BUDGET` + `RUN_WALL_CLOCK_BUDGET_S` (shared usage hook
  soft-budget flag). On breach, still emit `summary.json` with `source: "partial"`.

## 5. Backwards compatibility

- `runs/` layout and artifact names are unchanged (`spec.json`,
  `<out_name>[-<variation>].html`, `phases/*.json`, `report.md`, `summary.json`).
- Existing committed example runs remain valid.
- A single global `MODEL`/`MODEL_BASE_URL`/`MODEL_API_KEY` still drives all
  roles if the per-role vars are unset (kit fallback).

## 6. Verification

- `npm -w shared run typecheck` and `npx tsgo --noEmit` in the agent dir.
- `eve build` succeeds (snapshot traces `shared/*` via the workspace symlink).
- A live run produces `report.md` + `summary.json` with non-null tokens/cost and
  copies the run folder to the host via `sync_run_to_host`.
- No `reporter` subagent session is created.
