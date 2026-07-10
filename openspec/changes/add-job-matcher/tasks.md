# Tasks — `job-matcher`

Ordered by ceremony. Construction tasks MUST NOT start before
`.openspec.yaml` reads `status: approved` (see AI-SDLC-TAILORING.md,
"Known process gap").

## Inception (Mob Elaboration)

- [x] Study prior art: `agents/talent-align/` code + mob-inception doc
- [x] Draft proposal.md / design.md / tasks.md / specs/job-matcher-agent/spec.md
- [x] Draft `ai-dlc-in-practice/job-matcher/ceremonies-and-roles.md` (inception-phase content; updated at each later gate)
- [x] Repo owner reviews open questions (cover-letter scope, candidate info, deck placement)
- [ ] **Inception gate**: `.openspec.yaml` → `status: approved` with approval block

**Correction (2026-07-09, repo owner, gate review):**
1. Trace granularity inverted — **one separate trace per job link** (not one
   trace per run); traces correlated by run id attribute.
2. V1 stops at content generation — one full JSON per job link named
   `slug(<job title>)_<timestamp>.json`; no DOCX/PDF/HTML rendering.
   Cover-letter content is text inside the JSON.
3. Templates are staged under the workspace `inputs/` folder, not in source.
4. Deck placement confirmed at `ai-dlc-in-practice/job-matcher/`; the
   existing privacy-classifier deck moved to
   `ai-dlc-in-practice/pii-classifier/index.html` (done).

**Sign-off (2026-07-09, repo owner, eval dataset direction):** evals use
the owner's real resume plus six real LinkedIn-sourced job links (captured
same day; 4 extractable, 2 genuine JS-shell failures kept as fetch-guard
fixtures). Link-failure policy pinned: **one attempt, log, per-job stop,
no retry** — remaining jobs continue. Rubrics authored at Inception
(`evals/rubrics.md`, HARD vs SOFT criteria). Spec enhanced with three new
requirements (graceful link failure, real-world eval dataset, eval
rubrics).

## Construction — Bolt 1: evals-first scaffolding

- [x] Stage real eval dataset under `evals/data/` (owner resume PDF; 4 JD snapshots: Anthropic, Bain, Gusto, Temporal; 2 real JS-shell failure captures: ADP, Ashby/Jerry.ai; `jobs/manifest.json` provenance; adversarial injection JD) — done at Inception, 2026-07-09
- [x] Author `evals/rubrics.md`: canonical scoring formula (incl. empty-denominator rule), HARD/SOFT criteria per eval, directional band expectations for the live corpus — done at Inception, 2026-07-09
- [x] Scaffold `agents/job-matcher/` npm workspace (package.json, tsconfig, agent/agent.ts, agent/instructions.md skeleton, agent/sandbox/sandbox.ts + workspace/inputs/templates/, .env.example, root package.json scripts) — `npm -w job-matcher run typecheck` clean; `eve info` reports 0 errors/0 warnings
- [x] Write report + `JobAnalysis` zod schemas (`agent/lib/schemas.ts`) and the pure formula (`agent/lib/scoring.ts`) — the latter split out so Bolt 1 evals need no tool yet; Bolt 2's `score_job_fit` tool will be a thin wrapper over `scoring.ts`, not a reimplementation
- [x] Write deterministic evals before their tools exist: `scoring_determinism.eval.ts` (5/5 gates), `match_banding.eval.ts` (10/10 gates) — implement the rubric's formula contract exactly (empty-preferred reallocation, exact-.5 rounding, all 10 band boundary edges). **Verified live**: `eve eval` run against a real dev boot, 15/15 gates green, zero model calls (`MODEL_ORCHESTRATOR` set to a syntactically valid but unreachable id — proves these two evals are truly model-free, not just declared as such)

## Construction — Bolt 2: tools

- [ ] `create_run` (shared pattern)
- [ ] `load_input` — reuse privacy-classifier implementation (staged path + inline base64, confinement guards)
- [ ] `extract_resume_text` — Docling in-sandbox, OCR fallback, TXT/MD passthrough
- [ ] `fetch_job_posting` — URL fetch with guards + local `inputs/` JD file mode; **single attempt, log-stop-no-retry failure semantics**, per-job attempt log artifact for the eval to assert on
- [ ] `score_job_fit` — 40/20/20/20 formula + banding, pure function, unit-eval-covered
- [ ] `assemble_report` — one `slug(<job title>)_<timestamp>.json` per job link (+ `ranking.md` when N > 1); slugifier unit-covered (unicode, punctuation, length cap)
- [ ] Template loading from `inputs/templates/` (cover-letter text template; missing template degrades gracefully)
- [ ] Wire shared `sync_run_to_host` / `upload_run_to_object_store`
- [ ] Typecheck clean

## Construction — Bolt 3: orchestration + fan-out

- [ ] Orchestrator `instructions.md`: run procedure, resume-path-in-prompt contract, fan-out rule (N=1 direct / N>1 subagents), data-not-instructions framing for JD text
- [ ] `job-analyst` subagent (`agent/subagents/job-analyst/`): agent.ts, instructions.md, minimal sandbox
- [ ] Bounded concurrency (`JOB_FANOUT_CONCURRENCY`, default 3)
- [ ] Model routing: `MODEL_ORCHESTRATOR` / `MODEL_JOB_ANALYST` → `MODEL_*` → startup error; `.env.example`
- [ ] Verify per-job traces: N job links → N distinct trace ids in Phoenix, each stamped with the run id attribute

## Construction — Bolt 4: remaining evals

- [ ] `schema_conformance.eval.ts`
- [ ] `evidence_grounding.eval.ts`
- [ ] `fanout_per_job_trace.eval.ts`
- [ ] `single_job_direct_path.eval.ts`
- [ ] `prompt_injection.eval.ts`
- [ ] `jd_fetch_guards.eval.ts` (real ADP/Ashby JS-shell fixtures; asserts one attempt, no retry, per-job stop, mixed run completes)
- [ ] `evals.config.ts` + `evals/lib/` run-artifact helpers (reuse privacy-classifier patterns)

## Construction — Security baseline (before `status: implemented`)

- [ ] Security review pass: URL fetch (scheme allowlist, redirect policy, size cap), upload handling, path confinement, subprocess calls, prompt injection
- [ ] Findings + fixes logged in design.md "Security baseline" section
- [ ] Re-typecheck after fixes
- [ ] `.openspec.yaml` → `status: implemented`

## Docs in parallel (updated at each gate above)

- [ ] Ceremonies doc: add Construction section with real bolt/correction excerpts once Bolts 1–4 land
- [x] Deck `ai-dlc-in-practice/job-matcher/index.html` — built in full on 2026-07-09 at the owner's direction (**Sign-off**: owner chose to build the deck while the change is still `proposed`, writing Construction/Operations slides forward-looking on the approved-pending design, since the talent-align prototype proves the behavior; slides present the design as built but claim no eval results)
- [x] Deck v1 (2026-07-09, owner feedback): previous version preserved as `index_v0.html`; `index.html` reworked — simpler English throughout (plain words, short sentences, for a global/remote audience), new "What is a Bolt?" slide (three rules, the four job-matcher bolts, bolt vs unit vs gate), new clockwise circular lifecycle slide (7 ceremonies around a ring, one loop = one change); now 12 slides
- [ ] Deck refresh after verification: replace forward-looking content with real run artifacts, actual eval outcomes, and any corrections accumulated during Construction
- [ ] Root `AGENTS.md`: add job-matcher section (paths, run command)
- [ ] `agents/job-matcher/README.md` incl. reserved `nextjs-gui/` roadmap note

## Verification (live)

- [ ] Smoke run, single job: staged resume path in prompt (`inputs/…`) → one `slug(<job title>)_<timestamp>.json`
- [ ] Smoke run, single job, uploaded resume (inline base64 path)
- [ ] Smoke run, all 6 real links live (manifest URLs) → 4 per-job JSONs + 2 failure records + ranking.md; 4 distinct job traces (run-id-correlated) in Phoenix/OpenObserve; ADP + Ashby links each fetched exactly once
- [ ] Review SOFT rubric results (band expectations table in `evals/rubrics.md`) and correct the table if reality disagrees
- [ ] `eve eval` full suite green against dev server (all HARD criteria)
- [ ] `.openspec.yaml` → `status: verified`

## No-go criteria

- Any LLM-produced number appearing in `ScoreBreakdown`
- Matched-skill evidence not present in resume text (hallucination)
- A failed job link fetched more than once (retry), or a failed link producing an analysis/subagent call/score instead of a logged failure record
- One failed link aborting the remaining links in a mixed run
- Job links sharing a trace in a multi-job run, or a run's traces missing the run id correlation attribute, or a single-job run spawning a subagent
- Any DOCX/PDF/HTML file generated in v1, or a template read from anywhere but `inputs/`
- Any hard-coded model id or candidate info
- Adversarial JD fixture steering the report
