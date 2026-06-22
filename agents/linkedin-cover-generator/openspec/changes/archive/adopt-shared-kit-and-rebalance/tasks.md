# Tasks

> Implementation starts in a new session. Order is incremental and verifiable;
> each phase ends in a typecheck + `eve build`.

## Phase 1 — Adopt the shared kit (ADR 0001)

- [x] Add `"shared": "*"` to `package.json`; remove `#shared/*` and
      `#lib/model.js` from `imports` (keep `#lib/schemas.js`,
      `#lib/prompt-builder.js`, `#lib/palettes.js`, `#lib/presets.js`).
- [x] Delete `agent/lib/model.ts`; switch `agent/agent.ts` to
      `resolveModel("orchestrator", …)` from `shared/lib/model.js`.
- [x] Replace `agent/hooks/usage.ts` and `agent/tools/read_usage.ts` with
      one-line re-exports of the shared modules.
- [x] Replace `agent/tools/write_report.ts` with `agent/tools/sync_run_to_host.ts`
      (re-export of `shared/tools/sync_run_to_host.js`); wire it as the final
      orchestrator step.
- [x] Route `create_run` / `write_run_file` through `shared/lib/run.ts`.
- [x] Extend `agent/sandbox/sandbox.ts` from `createBaseSandbox()`.
- [x] `npm -w shared run typecheck` + `npx tsgo --noEmit` + `eve build` clean.

## Phase 2 — Replace the LLM reporter with a deterministic tool

- [x] Add `agent/tools/render_and_save_report.ts`: read `phases/*.json` +
      `run-meta.json`, compute metrics via `buildRunSummary`
      (`shared/lib/summary.js`), write `report.md` + `summary.json`. No LLM.
- [x] Delete `agent/subagents/reporter/**`.
- [x] Update `agent/instructions.md`: step 9 calls `render_and_save_report`
      (remove the reporter delegation); step 10 calls `sync_run_to_host`; remove
      all reporter-subagent language and the "subagents have isolated sandboxes"
      paragraph that only applied to the reporter.
- [x] Confirm no `reporter` subagent session is created on a live run.

## Phase 3 — Finalize models + `.env.example` (GPT/OpenAI)

- [x] Rewrite `agent/.env.example` to the OpenAI matrix:
      `MODEL_ORCHESTRATOR=gpt-5.4-mini` on `https://api.openai.com/v1` +
      `OPENAI_API_KEY`; `IMAGE_MODEL=gpt-image-2` + `IMAGE_BASE_URL` +
      `IMAGE_API_KEY`; keep `ENABLE_REVIEW`, `MAX_IMAGE_RETRIES`, `ALLOW_COST`,
      budget vars, and a generic `MODEL*` fallback example.
- [x] Update `README.md` model-configuration section to the OpenAI matrix and
      remove the reporter subagent from the architecture description.

## Phase 4 — Skill consolidation

- [x] Keep `art_direction`, `linkedin_layout`, `brand_safety`, `title_crafting`.
- [x] Remove the reporter LLM skills (`cost_rates`, `report_template`) once the
      deterministic report tool covers them.

## Verification (Definition of Done)

- [x] `eve build` clean; live run emits `cover.png`, `cover-spec.json`,
      `report.md`, `summary.json` with non-null tokens + cost.
- [x] Run folder is copied to the host by `sync_run_to_host`.
- [x] No reporter LLM session; exactly one creative orchestrator pass.
- [x] `agent/lib/model.ts` and the `glm-4.5-air` default are gone.
