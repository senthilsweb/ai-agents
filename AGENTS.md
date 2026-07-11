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

### Job Matcher (`agents/job-matcher/`)

Compares a candidate's resume against one or more job postings and produces
one scored, evidence-grounded JSON report per job — a governed rebuild of
the vibe-coded `agents/talent-align/` prototype (kept untouched as the
"before" teaching prop), and the running example for
`ai-dlc-in-practice/job-matcher/`. Headless, no GUI (`nextjs-gui/` is a
reserved later phase). One generative step only: typed skill/evidence
extraction. Scoring is a pure deterministic function (`agent/lib/scoring.ts`)
— the LLM never emits a number, which is also the agent's prompt-injection
defense. Fan-out: exactly one job link runs through a direct tool call
(`analyze_job_fit`); more than one delegates to the `job-analyst` subagent
once per job, each its own eve session.

All paths below are relative to `agents/job-matcher/`:

- `agent/instructions.md` — the always-on **Orchestrator** system prompt.
- `agent/tools/*.ts` — deterministic tools: `create_run`, `load_input`,
  `extract_resume_text` (pure Node: unpdf for PDF, mammoth for DOCX — no
  Python/Docling, no OCR, scanned PDFs rejected),
  `fetch_job_postings` (one call for every job source, bounded concurrency,
  exactly one attempt per source, no retry), `score_job_fit`,
  `assemble_report`; plus `analyze_job_fit`, the one tool that calls a
  GenAI model (the N=1 direct-call path — mirrors privacy-classifier's
  tool-wraps-the-model-call pattern).
- `agent/subagents/job-analyst/` — the N>1 fan-out path; `outputSchema` on
  its own `agent.ts` runs it in task mode, returning a validated
  `JobAnalysis` directly, no raw-JSON-in-prose parsing.
- `agent/lib/scoring.ts` — the pinned scoring formula (40/20/20/20 +
  match bands), pure and unit-eval-covered before any tool wraps it.
- `agent/sandbox/sandbox.ts` — plain shared base sandbox (no Python
  bootstrap, unlike privacy-classifier), so the agent deploys on Vercel
  the same way as linkedin-cover-generator.
- `openspec/changes/add-job-matcher/` — the full design spec, including a
  "Security baseline" section and two logged Construction-time corrections.
- `evals/*.eval.ts` — 8 evals; `evals/rubrics.md` states the canonical
  scoring formula and HARD/SOFT pass criteria for each, written at
  Inception. `evals/data/` holds a real resume + real 2026-07-09
  LinkedIn-sourced job postings, including two genuine JavaScript-shell
  fetch failures kept as fixtures for the graceful-failure requirement.

Run: `cd agents/job-matcher && nvm use 24 && npx eve dev --port 3535`
(use `npx eve dev` directly, not `npm run dev` — the latter can pick up
the wrong Node version; see the agent's README)

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
- `runs/` is committed so history is preserved. **Exception:**
  job-matcher's runs are gitignored — they contain the candidate's real
  resume/PII (see `openspec/changes/refactor-job-matcher/proposal.md` D8,
  which also questions this convention repo-wide).
- All models are resolved from env vars — no hard-coded model defaults.
  Each role resolves `MODEL_<ROLE>_* → MODEL_* → startup error`.
