# Tasks

> Implementation starts in a new session. Order is incremental and verifiable;
> each phase ends in a typecheck + `eve build`.

## Phase 1 — Adopt the shared kit (ADR 0001)

- [x] Add `"shared": "*"` to `package.json`; remove `#shared/*` and
      `#lib/model.js` from the `imports` map.
- [x] Delete `agent/lib/model.ts`; switch `agent/agent.ts` and
      `agent/subagents/renderer/agent.ts` to `resolveModel(role, …)` from
      `shared/lib/model.js` (no hard-coded default).
- [x] Replace `agent/hooks/usage.ts` and `agent/tools/read_usage.ts` (and the
      renderer subagent copies) with one-line re-exports of the shared modules.
- [x] Add `agent/tools/sync_run_to_host.ts` (re-export); wire it as the final
      orchestrator step in `instructions.md`.
- [x] Route `create_run` / `write_run_file` through `shared/lib/run.ts`
      (`createRunId`, `ensureRunDirs`, `writeRunArtifact`).
- [x] Extend `agent/sandbox/sandbox.ts` and the renderer sandbox from
      `createBaseSandbox()` (`shared/sandbox/base-sandbox.js`).
- [x] `npm -w shared run typecheck` + `npx tsgo --noEmit` + `eve build` clean.

## Phase 2 — Replace the LLM reporter with a deterministic tool

- [x] Add `agent/tools/render_and_save_report.ts`: read `phases/*.json` +
      `run-meta.json`, compute timing/tokens/cost via `buildRunSummary`
      (`shared/lib/summary.js`), write `report.md` + `summary.json`. No LLM.
- [x] Delete `agent/subagents/reporter/**`.
- [x] Delete skills `write_report.md`, `report_template.md`, `cost_rates.md`.
- [x] Update `agent/instructions.md` §5: replace "delegate to reporter subagent"
      with "call `render_and_save_report`"; remove all reporter language.
- [x] Confirm no `reporter` subagent session is created on a live run.

## Phase 3 — Finalize models + `.env.example` (GPT/OpenAI)

- [x] Create `agent/.env.example` with the OpenAI default matrix:
      `MODEL_ORCHESTRATOR=gpt-5.4-mini`, `MODEL_RENDERER=gpt-4o-mini`,
      `IMAGE_MODEL=gpt-image-2`, all on `https://api.openai.com/v1` +
      `OPENAI_API_KEY`, plus budget vars and the generic `MODEL*` fallback block.
- [x] Update `README.md` model-configuration section to the OpenAI matrix and
      remove the reporter subagent from the architecture description.

## Phase 4 — Guardrails (curb token burn)

- [x] Renderer: enforce `RENDER_MAX_ITERATIONS` (default 4) + per-render
      wall-clock budget; on exceed → `qc.passed: false`, continue.
- [x] Orchestrator: wire `RUN_STEP_BUDGET` + `RUN_WALL_CLOCK_BUDGET_S` via the
      shared usage-hook soft-budget flag; emit `summary.json` with
      `source: "partial"` when a budget trips.

## Phase 5 — Skill consolidation

- [x] Keep `build_spec`, `design_system`, `render_diagram`, `prompt_template`.
- [x] Remove now-orphaned reporting skill copies under subagents.
- [x] Verify each surviving role loads only the skills it needs.

## Verification (Definition of Done)

- [x] `eve build` clean; live run emits `report.md` + `summary.json` with
      non-null tokens + cost.
- [x] Run folder is copied to the host by `sync_run_to_host`.
- [x] No reporter LLM session; renderer runs the fast model within the iteration
      ceiling.
- [x] `agent/lib/model.ts` and the `deepseek-v4-pro` default are gone.
