# Refactor job-matcher — defect log and refactor proposal

**Status: proposed** (defect log only — scope and design to be planned
2026-07-11). Raised by the owner after the first day of live operation
(2026-07-10): the agent now works end-to-end, but it got there through
four in-flight corrections layered on the original design. The owner
prefers a complete refactor over further patching.

## Why (owner's position)

The current implementation is the *residue of debugging*, not the result
of a design. Corrections 1–4 in `add-job-matcher/design.md` each fixed a
real defect, but each was scoped to "make tonight's run work". A refactor
should start from what we now know and design the agent right, rather
than carry the patch history forward.

## Defect log (what the first live day exposed)

Numbered for reference in tomorrow's planning. "Fixed" means patched in
Construction; the refactor should re-solve these by design, not keep the
patches as-is.

| # | Defect | State | Root lesson for the refactor |
|---|---|---|---|
| D1 | `#lib/*.js` self-imports crash `eve dev` at turn start (`LoadCompiledModuleMapError`) — eve 0.11.10 native-imports the module map, which cannot map `.js` specifiers to `.ts` sources | Patched (`.ts` extensions + `allowImportingTsExtensions`) | Repo-wide inconsistency: privacy-classifier and linkedin-cover-generator still use `#lib/*.js` and will hit the same crash. Decide one convention for the whole monorepo. |
| D2 | Docling sandbox bootstrap (~5.4GB Python venv, ~25-min template build) — overkill for one resume and blocked Vercel deployment | Patched (pure-Node unpdf/mammoth, Correction 3) | Right-size dependencies to the document scope from the start; make "deployable on Vercel" an explicit requirement, not an afterthought. |
| D3 | Extraction produced one giant line; the orchestrator's `read_file` truncated it, sending the model on a bash detour and a doubled analysis call | Patched (word-wrap at 120 chars) | Tool outputs must be shaped for their actual consumers (including the harness's own limits) — validate the full read path, not just the write. |
| D4 | Pass-through-context tool contracts: the orchestrator model retyped the resume + job text (~83s), the JobAnalysis (~28s), and every analysis again into successive tool calls — >110s of a 141s run was the model copying | Patched (pass-by-reference: `analysis/<i>.json`, paths in tool args, Correction 4) | Pass-by-reference must be the default contract style for every payload larger than a sentence. Audit all remaining contracts. |
| D5 | Multi-job fan-out is still slow (~312s for 3 jobs): each `job-analyst` delegation message carries the full resume + job text, because subagents share no sandbox | Open | Revisit the fan-out design itself: options include a code-level fan-out inside one tool (`mapWithConcurrency` over N `generateObject` calls — no subagents, no retyping), shared workspace access for subagents if eve supports it, or accepting the cost knowingly. This decision shapes the whole architecture. |
| D6 | Score calibration: `claude-haiku-4-5` marks nearly every skill matched (95–100/100, everything "strong_match") where `claude-sonnet-5` scored the same job 72/100 — rankings stop discriminating | Open | The scoring formula is deterministic but its *inputs* (matched counts) are model-judged. The refactor needs a calibration story: stricter matching rubric in the prompt, a fixed analyst model, eval thresholds that catch leniency, or all three. |
| D7 | Dev-mode fragility: `create_run` writes into the watched `agent/sandbox/workspace/`, triggering mid-turn rebuilds (one session stalled permanently); killed servers leave stale `.eve/dev-server.json`/`dev-process.pid` blocking restarts; orphaned template builds/session containers accumulate | Open (framework-level, but our layout aggravates it) | Move run output out of the watched tree (see D8), and document the recovery steps. Consider reporting the watcher and stale-pid issues upstream to eve. |
| D8 | `runs/` under `agent/sandbox/workspace/` mixes machine output (and the candidate's real resume/PII) into the source tree; the monorepo convention "runs/ is committed" is wrong for an agent whose runs contain personal data | Gitignored 2026-07-10 (this change) | Decide where run artifacts belong (object store? a top-level untracked `runs/`?) and align the monorepo convention. |
| D9 | Model/env misconfiguration failed late and cryptically: `MODEL_JOB_ANALYST_BASE_URL=https://api.anthropic.com` produced `404 Not Found` from deep inside a turn after minutes of sandbox warm-up | Patched (docs + comments) | The refactor should validate model config at startup (one cheap ping per role, or at least URL-shape checks in `resolveModel`) so misconfiguration fails in seconds, not minutes. |

## Refactor intent (to be designed tomorrow)

Not decided yet — tomorrow's planning session decides scope. Candidate
directions the owner and the log point at:

1. **Contract-first rebuild of the tool set**: every tool takes ids and
   paths, returns small typed summaries; payloads live in the run folder.
   (Generalize Correction 4 instead of keeping it as a patch.)
2. **Re-decide the fan-out** (D5): subagents vs in-tool concurrent
   `generateObject` fan-out. The in-tool option removes the delegation
   retyping cost and most of the multi-job wall clock, at the price of
   per-job trace separation — weigh against the observability goals.
3. **Calibration and evals** (D6): pin the analyst model, tighten the
   matching rubric, add a leniency eval (a deliberately weak resume must
   not score strong_match).
4. **Run-artifact layout** (D7/D8): out of the watched tree, out of git,
   into the object store by default.
5. **Startup validation** (D9) and a repo-wide decision on import
   conventions (D1).

## Constraints carried over

- The prompt-injection defense (LLM never emits a score; deterministic
  scoring only) is non-negotiable and stays.
- The 8 evals and `evals/rubrics.md` remain the acceptance surface; the
  refactor must keep them green (updating contracts where the tool
  signatures change).
- `agents/talent-align/` stays untouched as the "before" teaching prop.
- Vercel deployability (no apt-get/Python bootstrap) is now a hard
  requirement.

## Process note

Per `AI-SDLC-TAILORING.md`: this file is the Inception input for the
refactor. Tomorrow's session produces `design.md` + `tasks.md` and flips
`status` to `approved` before any Construction begins.
