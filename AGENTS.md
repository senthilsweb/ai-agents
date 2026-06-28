# Agents — Vercel Eve Monorepo

This monorepo hosts multiple [eve](https://vercel.com/eve) agents. Each agent
lives under `agents/<name>/` and follows the shared conventions below.

Before writing code for any agent, read the relevant guide in `node_modules/eve/docs/`.

---

## Agents

### Diagram Generator (`agents/diagram-generator/`)

Generates stunning, self-contained HTML architecture diagrams from a description
or reference image. Records each run under a timestamped `runs/` folder with a
metrics report.

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

Run: `cd agents/diagram-generator && npm run dev`

### API Test Generator (`agents/api-test-generator/`)

Turns an OpenAPI 3.x specification into a production-ready Postman collection
with pairwise test coverage, Newman execution, and a coverage report. Uses a
three-model strategy: Sonnet (orchestrator), Opus (combinatorial factor analysis),
Haiku (assertion script generation). 95% deterministic by token count.

All paths below are relative to `agents/api-test-generator/`:

- `agent/instructions.md` — the always-on **Orchestrator** system prompt.
- `agent/skills/*.md` — load-on-demand skills: `openapi_parse`, `naming_rules`,
  `pairwise_strategy`, `collection_assembly`, `assertion_contract`, `report_template`.
- `agent/tools/*.ts` — deterministic tools: `parse_openapi`, `apply_naming_rules`,
  `generate_pairwise_matrix`, `assemble_collection`, `run_newman`,
  `validate_collection`, `assemble_report`.
- `agent/subagents/pairwise-designer/` — claude-opus-4-8 subagent for factor analysis.
- `agent/subagents/assertion-writer/` — claude-haiku-4-5-20251001 subagent for pm.test() generation.
- `openspec/openspec.md` — full design specification.
- Drop OpenAPI specs into `agent/sandbox/workspace/inputs/`.

Run: `cd agents/api-test-generator && npm run dev`

---

## Monorepo Conventions

- Add agent-private helpers under `agent/lib/` (import-only, never mounted).
  Cross-agent shared code lives in the root `shared/` folder (import via
  `#shared/*`).
- Skills are scoped per agent; copy markdown under each agent that needs it.
- Subagents are declared under `agent/subagents/<name>/` with their own
  `agent.ts`, `instructions.md`, `sandbox/`, and `skills/`.
- `runs/` is committed so history is preserved.
- All models are resolved from env vars — no hard-coded model defaults.
  Each role resolves `MODEL_<ROLE>_* → MODEL_* → startup error`.
