## Why

The diagram generator uses a single model for both the orchestrator and the
renderer/reporter subagents. Reasoning models (e.g. GLM-5.2) excel at
orchestration — analyzing images, writing specs, delegating tasks — completing
in ~5 min for ~$0.12. However, the same reasoning model used for the renderer
subagent gets stuck in infinite chain-of-thought loops (50+ min, 0 output) and
never writes the HTML diagram. A non-reasoning model (e.g. GLM-4.5-Air) would
generate the HTML directly in 2–5 min at a fraction of the cost. We need
per-role model selection so the orchestrator can use a reasoning model while
subagents use a fast non-reasoning model.

## What Changes

- Add per-role model configuration via environment variables: separate
  `MODEL_ORCHESTRATOR`, `MODEL_RENDERER`, `MODEL_REPORTER` overrides that fall
  back to the existing `MODEL` env var.
- Add per-role base URL and API key overrides (`MODEL_ORCHESTRATOR_BASE_URL`,
  `MODEL_RENDERER_BASE_URL`, etc.) so different roles can use different
  providers if needed.
- Update `agent/agent.ts` to construct separate model instances per role and
  pass the appropriate model when delegating to subagents.
- **BREAKING**: The built-in `agent` tool (copy-of-self) inherits the parent's
  model — it has no `model` parameter. To give the renderer/reporter a different
  model, we must switch from copy-of-self to **declared subagents**
  (`agent/subagents/renderer/`, `agent/subagents/reporter/`), each with their
  own `agent.ts` that wires a different model. This means subagents will get
  **isolated sandboxes** instead of sharing the parent's sandbox. The sandbox
  sharing workaround must be replaced with an explicit file-passing mechanism
  (the orchestrator writes spec/artifacts to `runs/` and the subagent reads
  them from there).
- Update `agent/instructions.md` to use `subagent(renderer, …)` and
  `subagent(reporter, …)` instead of the built-in `agent` tool.
- Copy relevant skills into each subagent's `skills/` directory (Eve scopes
  skills per-agent).
- Update `.env.example` with the new per-role variables.
- Update `README.md` with the new model configuration matrix.

## Capabilities

### New Capabilities
- `per-role-model-selection`: Ability to configure a different LLM model,
  base URL, and API key for each agent role (orchestrator, renderer, reporter)
  via environment variables, with fallback to a global default.

### Modified Capabilities
_(none — no existing specs in `openspec/specs/`)_

## Impact

- **`agent/agent.ts`**: Split single model construction into per-role model
  factories. The orchestrator's model is used for the orchestrator session;
  each declared subagent's `agent.ts` constructs its own model from env.
- **`agent/subagents/renderer/`** (new): Declared subagent with own `agent.ts`
  (reads `MODEL_RENDERER` env), own `skills/` (render_diagram, design_system),
  own `instructions.md`.
- **`agent/subagents/reporter/`** (new): Declared subagent with own `agent.ts`
  (reads `MODEL_REPORTER` env), own `skills/` (write_report, cost_rates,
  report_template), own `instructions.md`.
- **`agent/instructions.md`**: Change delegation from built-in `agent` tool to
  `subagent(renderer, …)` / `subagent(reporter, …)`. Remove sandbox-sharing
  language; replace with explicit `runs/` folder as the handoff mechanism.
- **`agent/sandbox/sandbox.ts`**: Each subagent gets its own sandbox session.
  The `runs/` folder is seeded into every subagent's sandbox (already is —
  it's part of the workspace template).
- **`agent/hooks/usage.ts`**: Hooks fire per-session. Declared subagents do
  **not** inherit parent hooks — each subagent needs its own copy of the usage
  hook (or the hook must be registered globally).
- **`.env.example`**: Add `MODEL_ORCHESTRATOR_*`, `MODEL_RENDERER_*`,
  `MODEL_REPORTER_*` variables with documentation.
- **`README.md`**: Update model configuration section with per-role examples.
- **Sandbox sharing loss**: The built-in `agent` tool shares the parent's
  sandbox (same Docker container, same `/workspace/runs/`). Declared subagents
  get isolated sandboxes. Since `runs/` is part of the workspace template
  (seeded from `agent/sandbox/workspace/`), files written by the orchestrator
  to `runs/` will be visible in the subagent's sandbox **only if** the
  orchestrator writes them before the subagent's sandbox is created. This
  timing issue must be addressed — likely by having the orchestrator write
  files and then the subagent reading them from the same seeded workspace.
