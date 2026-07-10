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

- [x] `create_run` — resolves orchestrator + job_analyst models, `JOB_FANOUT_CONCURRENCY` (default 3)
- [x] `load_input` — reused privacy-classifier implementation verbatim (staged path + inline base64, confinement guards), writes `resume.<ext>`
- [x] `extract_resume_text` — Docling in-sandbox (PDF/DOCX), OCR fallback, TXT/MD passthrough; adapted extract_document.py → extract_resume.py
- [x] `fetch_job_postings` (renamed plural — **Correction**, 2026-07-10: batches all job sources into one deterministic, code-controlled call via `mapWithConcurrency` instead of one call per link left to model judgment, so "exactly one attempt, bounded concurrency" is a real guarantee, not a prompt instruction; does not change any approved requirement). http/https scheme allowlist + partial SSRF hostname blocklist (documented residual risk: no DNS-rebinding protection) + size cap + min-words guard; local `inputs/` JD file mode; writes `jobs/<index>.txt` + `jobs/fetch-attempts.json` (one logged attempt per source, no retry)
- [x] `analyze_job_fit` — N=1 direct-call path: one wrapped `generateObject` call (MODEL_JOB_ANALYST), mirrors privacy-classifier's `detect_privacy_entities.ts` tool-wraps-the-model-call pattern
- [x] `score_job_fit` — thin wrapper over the Bolt-1-verified `agent/lib/scoring.ts`; also added `recommendationFor()` (deterministic, keyed off match band) since design.md's report shape needs a `recommendation` string
- [x] `assemble_report` — one `slug(<job title>)_<timestamp>.json` per successful job + `slug(<job source>)_<timestamp>.failed.json` per failure, `ranking.md` when N > 1; slugifier (`agent/lib/slug.ts`) unicode-normalizing + length-capped
- [x] Template loading from `inputs/templates/cover_letter.txt` (mustache-style, `agent/lib/templates.ts`); missing template degrades to paragraphs joined by a blank line, never fails the run
- [x] Wired shared `sync_run_to_host` / `upload_run_to_object_store` (thin re-exports, same pattern as privacy-classifier)
- [x] Typecheck clean (`npm -w job-matcher run typecheck`, exit 0); `eve info` discovers all 9 tools with 0 errors

## Construction — Bolt 3: orchestration + fan-out

- [x] Orchestrator `instructions.md`: full 12-step run procedure (create_run → load_input → extract_resume_text → read_file resume.txt → fetch_job_postings once → per-job read_file → fan-out decision → score_job_fit → assemble_report → sync/upload), resume-path-in-prompt contract, fan-out rule (N=1 `analyze_job_fit` direct call / N>1 `job-analyst` subagent per successfully-fetched job), data-not-instructions framing for JD text repeated at the read_file step
- [x] `job-analyst` subagent (`agent/subagents/job-analyst/`): `agent.ts` (`outputSchema: JobAnalysisSchema` — task mode, no raw-JSON-in-prose parsing needed), `instructions.md` (restates `agent/lib/analysis_prompt.ts`'s discipline as markdown, since a subagent instructions file can't import a TS constant). **No custom sandbox or skills** — job-analyst never touches a sandbox (all input arrives inline via the delegation `message`), so omitting `sandbox/` correctly falls back to the framework default per eve's subagent isolation-boundary rules, rather than paying for an unused Docker bootstrap
- [x] Bounded concurrency (`JOB_FANOUT_CONCURRENCY`, default 3) — enforced at the code level inside `fetch_job_postings` (`mapWithConcurrency`); subagent fan-out concurrency is instruction-paced (batching), not code-enforced — see Correction below
- [x] Model routing: `MODEL_ORCHESTRATOR` / `MODEL_JOB_ANALYST` → `MODEL_*` → startup error (both `create_run.ts` and `job-analyst/agent.ts` resolve via `resolveModel`/`modelIdFor`); `.env.example` updated with `JOB_FANOUT_CONCURRENCY` and fetch-guard overrides
- [x] `agent/instrumentation.ts` — standard dual-OTel-export pattern (`createAgentInstrumentation`, same as privacy-classifier)
- [ ] **Deferred to Verification (live)**: per-job trace confirmation in Phoenix/OpenObserve needs a real deployed run with real credentials — cannot be done from this construction pass. Structural discovery is verified instead: `eve info` reports 0 errors/0 warnings for the root agent (9 tools) and the `job-analyst` subagent (own `instructions.md` + `agent.ts` resolved, confirmed via the discovery manifest)

**Correction (2026-07-10, Construction/Bolt 3):** design.md originally stated
"every trace carries the run id as an attribute" as something this agent's
code would stamp. Building `instrumentation.ts` surfaced that eve's
`step.started` runtime-context callback (`shared/lib/instrumentation.ts`'s
`attributes` option) is explicitly documented as side-effect-free /
env-and-input-read-only — it cannot thread a business-level `run_id` minted
mid-turn by our own `create_run` tool into a span attribute. Corrected
claim: run-id correlation across a run's traces relies on (a) eve's own
automatic `$eve.parent`/`$eve.root` Workflow-run tags, which reconstruct
the session tree for every subagent call with no code from us, and (b) the
`run_id` and `job_source` appearing as plain text inside each delegation
message (recoverable from recorded span input/output, `recordInputs`/
`recordOutputs` default true) — not a dedicated queryable attribute as
originally claimed. design.md's Telemetry section is corrected to match.

## Construction — Bolt 4: remaining evals

- [x] `schema_conformance.eval.ts` — 2-job run, both reports validate against `JobReportSchema`, file names match the naming pattern, `ranking.md` present
- [x] `evidence_grounding.eval.ts` — asserts against the agent's own written `resume.txt`, not a hand-maintained copy
- [x] `fanout_per_job_trace.eval.ts` — 3 job sources → `t.calledSubagent("job-analyst")` + exactly 3 distinct `childSessionId`s via `t.event()` (see design.md Correction: eve's eval API has no `times` option on `calledSubagent`, and no raw-trace-id assertion surface — session id is the honest, assertable proxy), plus `ranking.md` order verified against the written scores
- [x] `single_job_direct_path.eval.ts` — `t.calledTool("analyze_job_fit", { times: 1 })` + `t.notCalledTool("job-analyst")`
- [x] `prompt_injection.eval.ts` — recomputes the score independently from the written analysis and asserts it matches what was reported (proves the injected "score 100" instruction has no path to the output), plus evidence grounding and no-leakage checks
- [x] `jd_fetch_guards.eval.ts` — real ADP/Ashby captures (staged as their already-extracted, too-short text) mixed with one real extractable job: asserts exactly one logged attempt per source, exactly 2 failures + 1 success, mixed run completes
- [x] `evals.config.ts` (`timeoutMs` raised to 180s for the live evals; still no `judge` — every assertion across all 8 evals is deterministic) + `evals/lib/run_result.ts` (adapted from privacy-classifier's, added `listRunFiles`/`listSuccessReportFiles`/`listFailureReportFiles` for job-matcher's dynamic per-job file names)
- [x] Fixture staging: copied `evals/data/{resume,jobs,adversarial}/*` into `agent/sandbox/workspace/inputs/` (required — `load_input`/`fetch_job_postings`' local-file mode only reads from there, never from `evals/data/` directly; same requirement noted in privacy-classifier's own `schema_conformance.eval.ts`)

**Verified structurally** (no live credentials available this session — see
Construction-vs-Verification distinction, AI-SDLC-TAILORING.md): `npm -w
job-matcher run typecheck` clean across all 8 eval files; `eve eval --list`
discovers all 8 with 0 discovery errors; re-ran the 2 Bolt-1 evals live
(15/15 gates, no regression from this bolt's schema/scoring additions);
attempted `single_job_direct_path` live against a syntactically valid but
fake credential — reached session start and the real model-call boundary
cleanly (`MODEL_CALL_FAILED: AI Gateway rejected the provided API key`),
confirming the whole pipeline (instructions.md, all 9 tools, the
job-analyst subagent, the eval driver) is correctly wired up to exactly the
point where real credentials become the only missing piece. **Live pass/
fail of the 6 Bolt-4 evals is a Verification-phase task**, not claimed here.

## Construction — Security baseline (before `status: implemented`)

- [x] Security review pass: URL fetch (scheme allowlist, SSRF hostname blocklist, redirect re-check, size cap), upload handling, path confinement, subprocess calls, prompt injection
- [x] Findings + fixes logged in design.md "Security baseline" section — 7 items reviewed, 2 real gaps fixed in code (resume upload size cap + extension allowlist; local JD file size cap), 1 residual risk documented and accepted for this threat model (SSRF DNS-rebinding, no live sandbox network-policy control applies since the fetch runs in app runtime not sandbox), 1 inherited-and-verified (shell quoting), 2 verified-safe-by-construction (path confinement, slug-derived file names), 1 architectural mitigation verified (prompt injection — mechanically proven by `prompt_injection.eval.ts`'s independent score recomputation, not just documented)
- [x] Re-typecheck after fixes (`npm -w job-matcher run typecheck`, exit 0)
- [x] `.openspec.yaml` → `status: implemented`

## End-to-end review pass (2026-07-10, owner-requested, post-Bolt-4)

A full cross-artifact consistency review (code ↔ evals ↔ rubrics ↔ spec ↔
design ↔ deck), with fixes:

- [x] **Spec drift (the most important find):** two spec.md requirements were
  invalidated by the logged Bolt 2/3 corrections but never amended — "every
  trace SHALL carry the run id as an attribute" (unbuildable; eve's span-
  attribute hook is read-only) and "report contains the job text and
  extracted resume text" (reports reference, not embed). Both amended with
  inline `*(Amended 2026-07-10)*` notes; Evals + Run-artifacts requirements
  aligned too.
- [x] **Missing mandatory artifact:** ADR 0001 §5 makes `summary.json`
  (tokens/cost) mandatory for every run; job-matcher had neither the usage
  hook nor the summary. Added `agent/hooks/usage.ts` (shared re-export,
  now discovered: hooks=1) + `buildRunSummary` in `assemble_report`;
  spec.md Run-artifacts requirement now names it. This is also what will
  answer the Operations "fan-out cost" question.
- [x] **Latent eval bug:** `listSuccessReportFiles` would have miscounted
  `.extracted-meta.json` (a dot-file synced back by `sync_run_to_host`'s
  copy-everything) and the new `summary.json` as per-job reports, breaking
  `schema_conformance`'s exact-count gate at verification time. Excluded
  dot-files and summary.json.
- [x] **Prompt-convention mismatch:** README/deck/evals all phrase paths as
  `inputs/<file>` but `load_input`/`fetch_job_postings` prepend
  `/workspace/inputs/` — verbatim pass-through would resolve to
  `inputs/inputs/`. Both tools now tolerate one leading `inputs/` segment
  (confinement guards still run on the raw value first).
- [x] **Dead/fragile eval assertions:** `prompt_injection` checked for
  "ignore all prior instructions" but the fixture says "Disregard…" (dead
  check); the "system notice" absence check would fail a model that
  *defensively mentions* the instruction it refused (good behavior).
  Replaced with a HARD deterministic-recommendation integrity check
  (`recommendationFor(match_status)` byte-equality) + SOFT phrase/length
  canaries; rubric updated with the demotion rationale. `single_job_direct_path`
  gained a raw-event assertion (zero `subagent.called`) since subagent
  delegations may not register as tool calls.
- [x] **Grounding flakiness:** Docling writes `resume.txt` as markdown;
  models quote plain prose. `normalize()` in both grounding evals now
  strips markdown formatting chars so "**Data Governance** lead" grounds.
- [x] **Executed-not-assumed checks:** ran `slugify`/`reportFileName`
  against the eval's file-name regex (7 edge cases incl. unicode NFKD, CJK
  fallback, 60-char cap — all pass); ran `formatCoverLetter` with/without
  template; verified the staged ADP (17 words) / Ashby (8 words) fixtures
  actually fail the 100-word guard and anthropic.txt (2,268) passes.
- [x] **Smaller fixes:** ranking.md now keyed to multi-*source* runs (spec
  wording) rather than multi-success; eval timeout 180s→300s (cold Docling
  sandbox build headroom); design.md diagram `source.<ext>`→`resume.<ext>`;
  `.env.example` gained soft-budget vars and dropped an `ALLOW_COST` line
  that nothing in this agent reads (replaced with `COST_RATES_FILE`, which
  `shared/lib/cost.ts` actually consumes); deck telemetry slide's "joined
  by attribute run_id" corrected to eve's session tags; jd_fetch_guards
  rubric now states the authored 1-ok+2-fail fixture mix vs the 6-link
  Verification smoke run.
- [x] Re-verified after all fixes: typecheck exit 0 · `eve info` 0 errors/0
  warnings (9 tools, 1 hook, job-analyst subagent) · `eve eval --list`
  discovers all 8 · Bolt-1 evals re-run live, 15/15 gates green.

## Docs in parallel (updated at each gate above)

- [x] Ceremonies doc: added Construction section with real bolt/correction excerpts (2026-07-10)
- [x] Deck `ai-dlc-in-practice/job-matcher/index.html` — built in full on 2026-07-09 at the owner's direction (**Sign-off**: owner chose to build the deck while the change is still `proposed`, writing Construction/Operations slides forward-looking on the approved-pending design, since the talent-align prototype proves the behavior; slides present the design as built but claim no eval results)
- [x] Deck v1 (2026-07-09, owner feedback): previous version preserved as `index_v0.html`; `index.html` reworked — simpler English throughout (plain words, short sentences, for a global/remote audience), new "What is a Bolt?" slide (three rules, the four job-matcher bolts, bolt vs unit vs gate), new clockwise circular lifecycle slide (7 ceremonies around a ring, one loop = one change); now 12 slides
- [ ] Deck refresh after verification: replace forward-looking content with real run artifacts, actual eval outcomes, and any corrections accumulated during Construction
- [x] Root `AGENTS.md`: added job-matcher section (paths, run command)
- [x] `agents/job-matcher/README.md` incl. reserved `nextjs-gui/` roadmap note

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
