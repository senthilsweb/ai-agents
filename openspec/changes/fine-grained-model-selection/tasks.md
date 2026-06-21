## 1. Orchestrator model configuration

- [ ] 1.1 Update `agent/agent.ts` to read `MODEL_ORCHESTRATOR`, `MODEL_ORCHESTRATOR_BASE_URL`, `MODEL_ORCHESTRATOR_API_KEY` env vars with fallback to `MODEL`, `MODEL_BASE_URL`, `MODEL_API_KEY`. Extract a `resolveModelConfig(role)` helper that returns `{ model, baseURL, apiKey }` for a given role.
- [ ] 1.2 Update `agent/instructions.md` to delegate via `subagent(renderer, …)` and `subagent(reporter, …)` instead of the built-in `agent` tool. Include the full spec JSON in the renderer delegation message. Include phase traces + token data in the reporter delegation message.
- [ ] 1.3 Update `agent/instructions.md` to write the renderer's returned HTML to its own sandbox via `write_run_file` after the renderer subagent returns.

## 2. Renderer declared subagent

- [ ] 2.1 Create `agent/subagents/renderer/agent.ts` — reads `MODEL_RENDERER*` env vars (fallback to `MODEL*`), constructs an OpenAI-compatible model instance. Include `modelContextWindowTokens` escape hatch.
- [ ] 2.2 Create `agent/subagents/renderer/instructions.md` — renderer system prompt (adapted from current `render_diagram` skill procedure). Includes: receive spec from message, write to own sandbox, generate HTML, self-verify with screenshot, return full HTML in response.
- [ ] 2.3 Copy `agent/skills/design_system.md` and `agent/skills/render_diagram.md` into `agent/subagents/renderer/skills/`.
- [ ] 2.4 Copy `agent/tools/write_run_file.ts`, `read_run_file.ts`, `fetch_lucide_icon.ts`, `render_screenshot.ts`, `read_usage.ts` into `agent/subagents/renderer/tools/`. Update import paths as needed.
- [ ] 2.5 Copy `agent/hooks/usage.ts` into `agent/subagents/renderer/hooks/usage.ts`.
- [ ] 2.6 Remove the "share parent sandbox" language from the renderer instructions — the renderer has its own sandbox and must write files locally.

## 3. Reporter declared subagent

- [ ] 3.1 Create `agent/subagents/reporter/agent.ts` — reads `MODEL_REPORTER*` env vars (fallback to `MODEL*`), constructs an OpenAI-compatible model instance.
- [ ] 3.2 Create `agent/subagents/reporter/instructions.md` — reporter system prompt (adapted from current `write_report` skill procedure). Includes: receive phase traces + token data from message, generate report.md, return full report content in response.
- [ ] 3.3 Copy `agent/skills/write_report.md`, `cost_rates.md`, `report_template.md` into `agent/subagents/reporter/skills/`.
- [ ] 3.4 Copy `agent/tools/write_run_file.ts`, `read_run_file.ts`, `read_usage.ts` into `agent/subagents/reporter/tools/`.
- [ ] 3.5 Copy `agent/hooks/usage.ts` into `agent/subagents/reporter/hooks/usage.ts`.

## 4. Environment variable documentation

- [ ] 4.1 Update `.env.example` with `MODEL_ORCHESTRATOR*`, `MODEL_RENDERER*`, `MODEL_REPORTER*` variables. Add comments explaining the fallback hierarchy. Include example configurations for: (a) same model for all roles, (b) reasoning orchestrator + fast renderer, (c) different providers per role.
- [ ] 4.2 Update `README.md` model configuration section with the per-role variable matrix and examples.

## 5. Cost rates update

- [ ] 5.1 Update `agent/skills/cost_rates.md` and `agent/subagents/reporter/skills/cost_rates.md` with GLM model pricing: GLM-5.2 ($1.40/M in, $4.40/M out), GLM-4.5-Air ($0.20/M in, $1.10/M out), GLM-4.5/4.6 ($0.60/M in, $2.20/M out).

## 6. .DS_Store fix (pre-existing issue)

- [ ] 6.1 Add `.DS_Store` to sandbox exclusion patterns or `.dockerignore` equivalent in `agent/sandbox/sandbox.ts` to prevent template rebuilds from macOS filesystem metadata changes.

## 7. Build and typecheck

- [ ] 7.1 Run `npm run build` and verify no TypeScript errors.
- [ ] 7.2 Run `npx eve info` and verify all three agents (orchestrator, renderer, reporter) are detected with their models.

## 8. End-to-end test

- [ ] 8.1 Configure `.env` with `MODEL_ORCHESTRATOR=glm-5.2`, `MODEL_RENDERER=glm-4.5-air`, `MODEL_REPORTER=glm-4.5-air` (all using z.ai base URL + same API key).
- [ ] 8.2 Start server (`npx eve dev --no-ui --port 3000`) and send a diagram generation request for `inputs/data-governance.png` with `fit=card, theme=light`.
- [ ] 8.3 Verify the orchestrator completes in <10 min, the renderer completes in <10 min, and `diagram.html` is produced.
- [ ] 8.4 Verify `read_usage` returns token data for all three session IDs (orchestrator, renderer, reporter).
- [ ] 8.5 Extract artifacts from Docker container, verify diagram is light mode and renders correctly.

## 9. Cleanup and commit

- [ ] 9.1 Remove the example run from the failed GLM-5.2 test (`runs/2026-06-20T21-37-48Z/` — only has spec.json, no diagram).
- [ ] 9.2 Commit the new example run (if test succeeds) with diagram HTML, spec, phase traces, and token data.
- [ ] 9.3 Commit and push all changes to remote.
