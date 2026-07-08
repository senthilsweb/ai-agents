# Agents — Vercel Eve Monorepo

This monorepo hosts multiple [eve](https://vercel.com/eve) agents. Each agent
lives under `agents/<name>/` and follows the shared conventions below.

Before writing code for any agent, read the relevant guide in `node_modules/eve/docs/`.

Every non-trivial change goes through `openspec/changes/<name>/` (proposal →
design → tasks → spec) before and during implementation — **this applies
repo-wide (root-level tooling, `shared/`, `openspec/` itself, and every
`agents/<name>/`), not just agent code.** See `AI-SDLC-TAILORING.md` at the
repo root for the full process, its status lifecycle (`proposed → approved →
implemented → verified → archived`), and where it deliberately trades the
full AI-DLC methodology for a lighter-weight equivalent.

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

### Privacy Classifier (`agents/privacy-classifier/`)

Classifies a document's PII/NPI content and the compliance regimes it
implicates (GDPR, CCPA/CPRA, India's DPDP Act, Argentina's PDPL, HIPAA, LGPD,
PIPEDA), independent of any downstream consumer. Fully single-agent — no
declared subagents. Fully deterministic except one step: PII/NPI detection,
made via a direct, parallel, strongly-typed `generateObject` call rather than
a subagent. Detection itself is swappable across four engines (`PII_ENGINE`):
`presidio` (local, no GenAI), `presidio_genai`, `openai_privacy_filter`
(reserved, not yet implemented), or `genai_only`. Local/on-prem only — see
`agents/privacy-classifier/PREREQUISITES.md` for external dependencies and
why this doesn't work as a Vercel serverless deployment.

All paths below are relative to `agents/privacy-classifier/`:

- `agent/instructions.md` — the always-on **Orchestrator** system prompt.
- `agent/tools/*.ts` — deterministic tools: `create_run`, `load_input`,
  `classify_document_structure` (columnar gate, shared re-export),
  `extract_document_text` (Docling, in-sandbox Python exec, OCR fallback),
  `chunk_text` (Chonkie semantic chunker, in-sandbox Python exec),
  `normalize_findings`, `map_compliance_impact`, `assemble_report`; plus
  `detect_privacy_entities`, the one engine-routed tool that calls a GenAI
  model and/or Presidio (Python, in-sandbox exec).
- `agent/sandbox/sandbox.ts` — bootstraps Python 3 + `docling` +
  `presidio-analyzer` + a spaCy model + `chonkie[semantic]` + `tesseract-ocr`
  (cached).
- `openspec/changes/add-privacy-classifier/` — the full design spec.
- `PREREQUISITES.md` — external dependencies and the Vercel-deployment caveat.
- `evals/*.eval.ts` — first adopter of eve's native eval harness in this repo.

Run: `cd agents/privacy-classifier && npm run dev`

---

## Monorepo Conventions

- Add agent-private helpers under `agent/lib/` (import-only, never mounted).
  Cross-agent shared code lives in the root `shared/` npm workspace package —
  import it as `shared/lib/<module>.js` (a real workspace dependency, listed
  in the agent's `package.json`), **not** a relative `#shared/*` path; see
  `openspec/adr/0001-shared-agent-runtime-kit.md` §1 for why.
- Skills are scoped per agent; copy markdown under each agent that needs it.
- Subagents are declared under `agent/subagents/<name>/` with their own
  `agent.ts`, `instructions.md`, `sandbox/`, and `skills/`.
- `runs/` is committed so history is preserved.
- All models are resolved from env vars — no hard-coded model defaults.
  Each role resolves `MODEL_<ROLE>_* → MODEL_* → startup error`.
