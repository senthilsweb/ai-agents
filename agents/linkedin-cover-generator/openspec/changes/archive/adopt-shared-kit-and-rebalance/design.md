# Design: Adopt the Shared Runtime Kit and Rebalance the LinkedIn Cover Generator

> Conforms to [`ai-agents/openspec/adr/0001-shared-agent-runtime-kit.md`](../../../../../../openspec/adr/0001-shared-agent-runtime-kit.md)
> and [`ai-agents/openspec/adr/0002-cost-matrix.md`](../../../../../../openspec/adr/0002-cost-matrix.md).

## 1. Deterministic vs. LLM boundary

```
input (file/url/text) ──► load_input (TOOL)
                               │
                               ▼
                      cover-spec.json ◄── LLM (orchestrator, ONE bounded pass)
                               │
            build_prompt (TOOL) ──► generate_image (TOOL, OpenAI image) ──► cover.png
                               │                                              │
                               ▼                                              ▼
                       validate_image (TOOL) ──► write_orchestrate_trace (TOOL)
                               │
phase traces ──► render_and_save_report (TOOL) ──► report.md + summary.json
                               │
                 sync_run_to_host (TOOL) ──► host
```

- **LLM, bounded**: a single pass to author `cover-spec.json` (title, palette,
  layout, art direction). `review` / `retry_on_failure` stay opt-in and
  single-shot — no open-ended loop.
- **Deterministic tools**: `create_run`, `load_input`, `build_prompt`,
  `generate_image`, `validate_image`, `write_orchestrate_trace`,
  `write_run_file`, `read_run_file`, `read_usage`,
  `render_and_save_report` (new), `sync_run_to_host`.

## 2. Model matrix (GPT/OpenAI default)

| Env var | Default | Provider | Class | Role |
|---------|---------|----------|-------|------|
| `MODEL_ORCHESTRATOR` | `gpt-5.4-mini` | `https://api.openai.com/v1` | reasoning (light) + vision | cover spec pass |
| `IMAGE_MODEL` | `gpt-image-2` | `https://api.openai.com/v1` | image | cover image |
| (reporter) | — | — | none | deterministic tool |

Resolution per ADR 0001 §4: `MODEL_<ROLE>_* → MODEL_* →` **throw**. Image
generation keeps its independent `IMAGE_*` vars (already implemented in
`generate_image.ts`).

## 3. File-by-file impact

### Replaced / removed
- `agent/lib/model.ts` → **deleted** (replaced by `shared/lib/model.js`; removes
  the `glm-4.5-air` hard-coded default).
- `agent/subagents/reporter/**` → **deleted** (LLM reporter retired).
- `agent/tools/write_report.ts` → **deleted/replaced** by
  `agent/tools/sync_run_to_host.ts` (re-export of the shared copy-back). The old
  tool conflated "copy run folder to host" with the report step; the two are now
  separate (deterministic report tool + shared copy-back).
- Local `agent/tools/read_usage.ts` → re-export of `shared/tools/read_usage.js`.

### Added
- `agent/tools/render_and_save_report.ts` — deterministic: reads `phases/*.json`
  + `run-meta.json`, computes metrics via `buildRunSummary` (shared), writes
  `report.md` + `summary.json`. No LLM.
- `agent/tools/sync_run_to_host.ts` — `export { default } from "shared/tools/sync_run_to_host.js"`.
- `agent/hooks/usage.ts` — `export { default } from "shared/hooks/usage.js"`.

### Modified
- `package.json` — add `"shared": "*"`; drop `#shared/*` and `#lib/model.js`;
  keep `#lib/schemas.js`, `#lib/prompt-builder.js`, `#lib/palettes.js`,
  `#lib/presets.js`.
- `agent/agent.ts` — `resolveModel("orchestrator", { providerName: "linkedin-cover-orchestrator" })`.
- `agent/instructions.md` — step 9 replaced: call `render_and_save_report`
  instead of delegating to the reporter subagent; step 10 calls
  `sync_run_to_host`; remove all reporter-subagent language.
- `agent/sandbox/sandbox.ts` — extend `createBaseSandbox()`.
- `.env.example` — rewritten to the OpenAI matrix above (keep `IMAGE_*`,
  `ENABLE_REVIEW`, `MAX_IMAGE_RETRIES`, `ALLOW_COST`, budget vars).
- `README.md` — model configuration → OpenAI matrix; remove the reporter
  subagent from the architecture description.

## 4. Backwards compatibility

- `runs/` layout and artifact names are unchanged (`cover.png`,
  `cover-spec.json`, `phases/*.json`, `report.md`, `summary.json`).
- The single global `MODEL*` fallback still drives the orchestrator if the
  per-role vars are unset.
- `generate_image.ts` already defaults to `gpt-image-2` on OpenAI — no change to
  its logic, only documented as the finalized default.

## 5. Verification

- `npm -w shared run typecheck` + `npx tsgo --noEmit` in the agent dir.
- `eve build` succeeds (snapshot traces `shared/*` via the workspace symlink).
- A live run produces `cover.png`, `cover-spec.json`, `report.md`, and
  `summary.json` with non-null tokens/cost, copied to the host by
  `sync_run_to_host`.
- No `reporter` subagent session is created.
