# Diagram Generator — Design Notes

Concise design record for this agent. Conforms to the monorepo ADRs
[`0001 — Shared Agent Runtime Kit`](../../openspec/adr/0001-shared-agent-runtime-kit.md)
and [`0002 — Cost Matrix`](../../openspec/adr/0002-cost-matrix.md). Full
rationale: [`openspec/changes/archive/adopt-shared-kit-and-rebalance`](openspec/changes/archive/adopt-shared-kit-and-rebalance/proposal.md)
(Done).

## Purpose

Turn a description or reference image into a **self-contained HTML architecture
diagram**, recorded under a timestamped `runs/` folder with a metrics report.

## Architecture

- **Orchestrator** (`MODEL_ORCHESTRATOR*`) — intake, spec building, image OCR,
  layout planning, run bookkeeping, report assembly. Reasoning + vision.
- **Renderer subagent** (`MODEL_RENDERER*`) — emits one HTML file from a finished
  spec, in an isolated Docker sandbox. Receives the spec in the delegation
  message; returns HTML + a phase trace. Fast, non-reasoning model.
- **No reporter model.** Report assembly is the deterministic
  `render_and_save_report` tool.

```
orchestrator ──spec──▶ renderer subagent ──HTML+trace──▶ orchestrator
       │                                                      │
       └── create_run / render_and_save_report / sync_run_to_host (deterministic tools)
```

## Determinism

The deterministic/LLM boundary is explicit and correctness-critical work never
touches a model:

| Concern | Mechanism |
|---|---|
| Run folder + `run-meta.json` | `create_run` (shared `lib/run`) |
| Artifact writes (host + sandbox mirror) | `writeRunArtifact` (shared `lib/run`) |
| Token accounting | shared usage hook + `read_usage` |
| Report (`report.md` + `summary.json`) | `render_and_save_report` — pure arithmetic/templating over phase traces |
| Copy-back to host | `sync_run_to_host` (shared, binary-aware for the preview PNG) |

The **renderer self-verify loop is bounded** — a hard `RENDER_MAX_ITERATIONS`
(default 4) screenshot ceiling and a `RENDER_WALL_CLOCK_BUDGET_S` (default 240s)
wall-clock budget. On exceed it records `qc.passed = false` rather than looping.

## Model resolution (ADR 0001 §4)

Each role resolves `MODEL_<ROLE>_* → MODEL_* →` an **explicit startup error**.
There is no built-in default — an unset role fails loudly rather than silently
selecting an expensive model. (The previous hard-coded `deepseek-v4-pro` default
was removed.)

**Finalized matrix:** orchestrator `gpt-5.4-mini`, renderer `gpt-4o-mini`
(both OpenAI). Any OpenAI-compatible provider works.

## Cost effectiveness

- **Right-sized models.** Reasoning is confined to the orchestrator; the
  renderer's markup task runs on a cheap, fast model — avoiding the
  chain-of-thought token burn a reasoning model incurs on pure generation.
- **No LLM for reports.** Deterministic assembly removes an entire model role.
- **Bounded loops.** The capped self-verify loop prevents runaway token/time
  spend.
- **Transparent cost.** `render_and_save_report` prices token usage from the
  shared cost matrix (`shared/cost/rates.yaml`, ADR 0002); unrated models record
  tokens with cost marked n/a — never a fabricated number.

## Shared kit

Model resolution, run-folder mirror, usage hook, cost pricing, copy-back, and the
base sandbox are consumed from the `shared` workspace package
(`import … from "shared/lib/*.js"`). Agent-private helpers use `#*`.
