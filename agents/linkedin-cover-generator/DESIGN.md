# LinkedIn Cover Generator — Design Notes

Concise design record for this agent. Conforms to the monorepo ADRs
[`0001 — Shared Agent Runtime Kit`](../../openspec/adr/0001-shared-agent-runtime-kit.md)
and [`0002 — Cost Matrix`](../../openspec/adr/0002-cost-matrix.md). Full
rationale: [`openspec/changes/archive/adopt-shared-kit-and-rebalance`](openspec/changes/archive/adopt-shared-kit-and-rebalance/proposal.md)
(Done).

## Purpose

Turn an article (local file, remote URL, or pasted text) into a polished
**LinkedIn cover image**, recorded under a timestamped `runs/` folder with a
metrics report.

## Architecture

A single **Orchestrator** with no subagents. One bounded reasoning pass plus
deterministic tools:

```
load_input ▶ [orchestrator: cover-spec] ▶ build_prompt ▶ generate_image ▶ validate_image
          ▶ render_and_save_report ▶ sync_run_to_host
```

- **Orchestrator** (`MODEL_ORCHESTRATOR*`) — one creative pass that writes
  `cover-spec.json`. Reasoning + vision (for optional reference images).
- **Image** (`IMAGE_MODEL`, default `gpt-image-2`) — the cover image itself.
- **No reporter model.** Report assembly is the deterministic
  `render_and_save_report` tool.

## Determinism

Exactly one LLM reasoning pass (the cover spec) and one image call; everything
else is deterministic code:

| Concern | Mechanism |
|---|---|
| Run folder + `run-meta.json` | `create_run` (shared `lib/run`) |
| Input extraction | `load_input` (Readability + gray-matter) |
| Image prompt | `build_prompt` — built from the spec, no model call |
| Dimension check | `validate_image` — exact pixels via sharp |
| Token accounting | shared usage hook + `read_usage` |
| Report (`report.md` + `summary.json`) | `render_and_save_report` — arithmetic/templating over phase traces |
| Copy-back to host | `sync_run_to_host` (shared, binary-aware for `cover.png`) |

**Loop policy (cost-bounded by default):** `ENABLE_REVIEW=false` skips the
reviewer; `MAX_IMAGE_RETRIES=0` means no regeneration. One optional retry only on
a hard validation failure, only when explicitly enabled.

## Model resolution (ADR 0001 §4)

Each role resolves `MODEL_<ROLE>_* → MODEL_* →` an **explicit startup error** —
no built-in default, so an unset role fails loudly.

**Finalized matrix:** orchestrator `gpt-5.4-mini`, image `gpt-image-2` (both
OpenAI). Any OpenAI-compatible provider works.

## Cost effectiveness

- **One reasoning pass, one image call.** No unbounded review/regeneration loop.
- **No LLM for reports.** Deterministic assembly removes a model role.
- **Deterministic validation.** Pixel checks via sharp catch failures without a
  model.
- **Transparent cost.** `render_and_save_report` prices token usage from the
  shared cost matrix (`shared/cost/rates.yaml`, ADR 0002); unrated models record
  tokens with cost marked n/a — never a fabricated number.

## Shared kit

Model resolution, run-folder mirror, usage hook, cost pricing, copy-back, and the
base sandbox are consumed from the `shared` workspace package
(`import … from "shared/lib/*.js"`). Agent-private helpers (`lib/schemas.ts`,
`lib/presets.ts`, `lib/palettes.ts`, `lib/prompt-builder.ts`) use `#lib/*`.
