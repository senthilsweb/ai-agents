# ADR 0001 — Shared Agent Runtime Kit

- **Status**: Accepted
- **Date**: 2026-06-22
- **Scope**: Monorepo-wide (`ai-agents/`), applies to every Eve agent under `agents/*`
- **Decision owners**: @senthilsweb
- **First implementation target**: `agents/github-pr-digest`

## Context

The monorepo hosts three independent Vercel Eve agents:

| Agent | Subagents | Purpose |
|-------|-----------|---------|
| `diagram-generator` | renderer, reporter | HTML architecture diagrams |
| `linkedin-cover-generator` | reporter (+ image tool) | LinkedIn cover images |
| `github-pr-digest` | repository-scout | PR activity reports |

Each agent independently re-implements the same cross-cutting concerns, in
mutually incompatible ways:

1. **Host copy-back (the core problem).** Eve runs tools inside a Docker
   sandbox; artifacts must reach the host workspace so the user can see them.
   - `github-pr-digest` dual-writes in **every** tool (`node:fs.writeFile` via
     `HOST_REPORT_ROOT` **and** `sandbox.writeTextFile`). The dual-write block
     is copy-pasted across `create_run`, `write_run_file`, `fetch_pull_requests`,
     and `render_and_save_report`.
   - `linkedin-cover-generator` runs a single `docker cp container:/workspace →
     host` at the end (`write_report.ts`), with a base64 fallback for binaries.
   - `diagram-generator` does **no** copy-back at all and assumes in-container
     persistence.
2. **Model resolution.** A `MODEL_<ROLE>_* → MODEL_* → default` resolver is
   duplicated 3×. `github-pr-digest` inlines ~30 lines in each `agent.ts` even
   though its `package.json` already maps `#lib/model.js → ./agent/lib/model.ts`
   (the file is empty).
3. **Run directory / `run-meta.json` / session→run mapping** — 3× variants.
4. **`write_run_file` / `read_run_file`** — near-identical 3×.
5. **Usage accounting hook + `read_usage` tool** — identical in diagram +
   linkedin; **entirely missing** in `github-pr-digest`.
6. **Cost rate card** (`cost_rates.md`) — exists only in `diagram-generator`.
7. **Sandbox bootstrap** (`.DS_Store` purge, Docker image pin) — 3×.

The `shared/` folder exists but is an empty placeholder; `#shared/*` is not even
wired into `github-pr-digest`.

There is also **spec drift** in `github-pr-digest`: the spec/README/tasks
describe a `Digest Reporter` **LLM subagent** and a `summary.json` output, but
the code replaced the reporter with a **deterministic** tool
(`render_and_save_report.ts`) and never emits `summary.json`. The instructions
explicitly forbid invoking `digest-reporter`.

## Decision

Create a small **Shared Agent Runtime Kit** under `shared/`, adopt it in
`github-pr-digest` first (smallest, most generic surface — highest leverage and
"critical mass"), then migrate `diagram-generator` and `linkedin-cover-generator`
onto the same kit.

### 1. Layout

```
shared/
  package.json                 # { "name": "shared", "private": true, "type": "module", exports }
  lib/
    model.ts                   # resolveModel(role): MODEL_<ROLE>_* → MODEL_* (NO default → throws)
    run.ts                     # createRunId(), run-folder helpers, writeRunArtifact, syncRunToHost
    usage.ts                   # eve-usage accumulator types + readAllUsage/sumUsage
    cost.ts                    # rate-card loader + per_token / per_request compute
    summary.ts                 # buildRunSummary() → summary.json (tokens + cost + budget)
  hooks/
    usage.ts                   # single eve-usage accounting hook (+ soft budget flag)
  tools/
    read_usage.ts              # read accumulated usage for the run
    sync_run_to_host.ts        # THE canonical copy-back
  sandbox/
    base-sandbox.ts            # createBaseSandbox(): image pin + .DS_Store purge; agents extend bootstrap
  cost/
    rates.yaml                 # single source-of-truth cost matrix (see ADR 0002 link below)
```

> **Implementation note.** `create_run` and `write_run_file` stay **agent-side**
> as thin wrappers over `shared/lib/run.ts` (`createRunId`, `ensureRunDirs`,
> `writeRunArtifact`), because they encode the agent's own run layout while the
> mirror/copy-back logic lives once in the shared kit.

Each agent consumes the kit as a **workspace dependency**: its `package.json`
adds `"shared": "*"` and imports modules by their package subpath
(`import { resolveModel } from "shared/lib/model.js"`). The agent keeps only
**agent-specific** logic (the GitHub tool, the renderer, the image tool) plus
its own skills/instructions. Skills remain per-agent (Eve scopes them per agent).

> **Implementation note (Eve v0.11.x).** Use a workspace dependency, **not** a
> relative subpath-imports map (`"#shared/*": "../../shared/*"`). Eve's
> dev-runtime source snapshot copies authored source by following package
> **dependency symlinks** (workspace packages linked into `node_modules`) and
> `tsconfig` path targets; it does **not** copy files reached only by a bare
> relative imports map that escapes the agent root. A workspace dependency is
> the mechanism Eve actually snapshots, compiles, and bundles — verified via
> `eve build`. npm links `shared` into `node_modules/shared`, and Eve follows
> that symlink into the snapshot. The shared package declares an `exports` map
> pointing each subpath (`./lib/model.js`, `./hooks/usage.js`, …) at its `.ts`
> source so Eve compiles it like any authored module.

### 2. Canonical copy-back — single `sync_run_to_host`

**Decision: centralize the run-folder mirror behind one shared helper, and ship
`sync_run_to_host` as the single, backend-agnostic, idempotent copy-back
primitive** — replacing `github-pr-digest`'s four copy-pasted per-tool
`HOST_REPORT_ROOT` blocks.

- All run-artifact writes go through one shared implementation
  (`shared/lib/run.ts` → `writeRunArtifact`), so the `node:fs` + sandbox-write
  blocks exist **once**, not duplicated in every tool.
- `sync_run_to_host(runId)` pulls every file in the sandbox run folder back to
  the host run folder in a single call. It is **backend-agnostic** — it uses
  the sandbox session's `readTextFile` API (no `docker cp`, so it works on
  Docker, Vercel Sandbox, microsandbox, etc.) — and idempotent.
- It is wired as the **final orchestrator step** and is the canonical mechanism
  for hosted / single-sandbox topologies.

> **Implementation note (Eve v0.11.x).** Subagents may run in **isolated
> sandboxes** (see §6 and the consequences below): a scout writes its collector
> file in the scout's sandbox, which the parent's renderer cannot read from the
> parent's sandbox. In the local/dev topology the **host run folder is the
> shared store** that bridges parent and subagent. The per-tool host writes are
> therefore **centralized into `writeRunArtifact` (which mirrors to host **and**
> sandbox), not deleted** — deleting them would break the scout→render data
> flow. Deterministic tools remain pure in the sense that they hold no bespoke
> copy-back logic; the mirror lives in one shared place. The original
> "sandbox-pure + delete all host writes" wording is the target for a future
> single-shared-sandbox topology; today the host mirror is the correctness
> bridge and `sync_run_to_host` is the canonical end-of-run primitive.

### 3. Tool-based vs prompt/skill-based logic is **use-case specific**

Determinism via **code tools** is the default for anything where correctness is
load-bearing (auth, pagination, date math, counting, money, file IO, the
copy-back). But we explicitly **do not** force every step into TypeScript:

- Pure **file/prompt/skill-based** steps are allowed and encouraged where the
  task is genuinely generative or judgement-based (art direction, title
  crafting, layout narrative, report prose) and where requiring programming
  would add friction without adding correctness.
- Heuristic: **if a wrong answer is a bug, use a code tool; if a wrong answer is
  a taste difference, a skill/prompt is fine.**

This supersedes the older blanket framing that "models are limited to
orchestration and presentation". Models may own generative steps; they must not
own steps whose correctness is verifiable.

### 4. Models: agnostic, per-role, env-resolved

The monorepo is **model-agnostic** — exactly as Eve is. No agent hard-codes a
model id or provider. Each role resolves its model from environment, and any
model or AI gateway that Eve supports is acceptable via its model/gateway
adapters — swappable in `.env` with no code change. Free auto-routing (e.g.
OpenRouter free) is **not** used as a default: it produced inconsistent
structured output and unpredictable cost.

Selection is by **role and model class**, not by brand:

| Role | Model class | Why |
|------|-------------|-----|
| Orchestrator | reasoning-class | spec analysis, planning, delegation |
| Renderer / generative subagent | fast non-reasoning-class | execution-heavy generation |
| Reporter (when LLM) | fast non-reasoning-class | data aggregation |
| Deterministic subagent (e.g. scout) | cheapest non-reasoning tier | LLM is glue only |

**Right model for the job (hard rule):** never put a heavy reasoning /
frontier model on a subagent or deterministic glue role. Doing so risks runaway
chain-of-thought and infinite loops (observed: 50+ min, 0 output) — see
`openspec/changes/fine-grained-model-selection`. Reasoning is confined to the
orchestrator.

**Swap via configuration only:** any model or provider can be changed in `.env`
using Eve's model and AI-gateway adapters; the agent code stays untouched.

Env contract (per role): `MODEL_<ROLE>`, `MODEL_<ROLE>_BASE_URL`,
`MODEL_<ROLE>_API_KEY`, each falling back to `MODEL` / `MODEL_BASE_URL` /
`MODEL_API_KEY`. There is **no built-in default model id**; an unset role is a
configuration error, not a silent fallback to a hard-coded model. Actual model
ids live only in each operator's `.env`.

### 5. Cost-conscious guardrails (mandatory)

Cost control must be **observable and enforced**, not aspirational:

- **Mandatory `summary.json`** per run, emitted from the shared `usage` hook +
  `cost.ts`, containing `{ tokens: {input, output, total, by_phase, source},
  cost: {currency, mode, total, by_phase, estimated} }`.
- **Reasoning only where it pays.** Reasoning-class models are confined to the
  orchestrator. Subagents and deterministic roles use fast non-reasoning-class
  models to avoid the documented "infinite chain-of-thought" failure (50+ min, 0
  output) — see `openspec/changes/fine-grained-model-selection`.
- **Loop ceilings.** Every agent sets a step/turn ceiling and a wall-clock
  budget; a run that exceeds the budget fails fast and still writes
  `summary.json` with `source: "partial"`.

  > **Implementation note (Eve v0.11.x).** Eve's public agent API exposes no
  > hard per-agent step ceiling (`defineAgent` has no `maxSteps`/`stopWhen`
  > field; the tool loop's stop condition is fixed internally). Loop discipline
  > is therefore enforced primarily by **model selection** (non-reasoning
  > subagents) and made **auditable** via a soft budget: the shared `usage`
  > hook reads `RUN_STEP_BUDGET` / `RUN_WALL_CLOCK_BUDGET_S` and flags
  > `budget.exceeded` in `summary.json` when crossed. Treat the "fail fast"
  > wording as the target once Eve exposes a hard cap; today the guarantee is
  > visibility, not interruption.
- **Cost matrix** lives once in `shared/cost/rates.yaml` — a provider-agnostic,
  operator-populated rate card keyed by whatever model ids are configured (see
  companion doc `openspec/adr/0002-cost-matrix.md`). Per-agent `cost_rates.md`
  skills become thin pointers to it.

### 6. Deterministic reporter is the norm

Report **assembly** (totals, tables, file layout) is a **code tool**, not an LLM
subagent — exactly what `github-pr-digest` already does with
`render_and_save_report.ts`. LLM "reporter" subagents are reserved for
**generative** report prose (diagram/linkedin narrative), not arithmetic.

## Consequences

### Positive
- One copy-back mechanism; deterministic tools stay sandbox-pure.
- Cost becomes measurable for every run; loop/reasoning failures are bounded.
- `github-pr-digest` gains the missing usage/cost surface for free.
- New agents start from a kit instead of copy-pasting three incompatible styles.

### Negative / risks
- Subagents get **isolated sandboxes**; cross-step data must pass through the run
  folder (already true for diagram/linkedin and the scout).
- A shared kit is a coupling point; breaking changes ripple to all agents.
  Mitigation: version `rates.yaml` and keep tool signatures additive.

## Implementation plan (phased)

**Phase 1 — `github-pr-digest` (this ADR's first target)**
1. Add real `shared/package.json`; wire `#shared/*` into the agent.
2. Move model resolution into `shared/lib/model.ts`; delete the inlined blocks in
   both `agent.ts` files; populate the empty `agent/lib/`.
3. Add `shared/hooks/usage.ts` + `shared/tools/read_usage.ts`; emit
   `summary.json` from `render_and_save_report` (or a sibling tool).
4. Replace the four per-tool `HOST_REPORT_ROOT` dual-writes with one
   `shared/tools/sync_run_to_host.ts` call at end of orchestration.
5. Switch model selection to fully env-driven per-role resolution with no
   hard-coded model id (reasoning-class orchestrator, fast non-reasoning-class
   scout).
6. **Fix the spec drift** (this PR): remove `Digest Reporter` LLM subagent +
   `summary.json`-via-reporter language from `spec.md`, `proposal.md`, `tasks.md`,
   `README.md`; document the deterministic reporter + model-agnostic per-role
   selection + `summary.json`
   metrics output.

**Phase 2 — `diagram-generator` + `linkedin-cover-generator`**
- Migrate onto `shared/` model/run/usage/cost/sandbox; collapse `write_report.ts`
  and per-tool writes onto `sync_run_to_host`; point `cost_rates.md` at
  `shared/cost/rates.yaml`.

## Related
- `openspec/adr/0002-cost-matrix.md` — the provider-agnostic, operator-populated rate card.
- `openspec/changes/fine-grained-model-selection` — per-role model rationale and
  the infinite-reasoning finding for heavy reasoning models on subagents.
