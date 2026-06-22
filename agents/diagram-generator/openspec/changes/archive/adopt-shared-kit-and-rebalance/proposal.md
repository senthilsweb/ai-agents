# Proposal: Adopt the Shared Runtime Kit and Rebalance the Diagram Generator

> **Status: Done** — implemented and verified 2026-06-22 (typecheck + `eve build`
> clean; all tasks complete). Archived.

> Conforms to [`ai-agents/openspec/adr/0001-shared-agent-runtime-kit.md`](../../../../../../openspec/adr/0001-shared-agent-runtime-kit.md)
> and [`ai-agents/openspec/adr/0002-cost-matrix.md`](../../../../../../openspec/adr/0002-cost-matrix.md).
> First kit consumer (reference implementation): [`agents/github-pr-digest`](../../../../../github-pr-digest).

## Why

The diagram generator works but carries three problems the shared kit and a
model rebalance are meant to fix:

1. **Duplicated runtime plumbing.** Model resolution, run-folder/`run-meta`
   bookkeeping, `read_usage`, the usage hook, the cost rate card, and sandbox
   bootstrap are all re-implemented locally — the exact duplication ADR 0001
   exists to remove. `agent/lib/model.ts` even carries a **hard-coded default
   model** (`deepseek-v4-pro`), which ADR 0001 §4 forbids (an unset role must
   fail loudly, never silently pick an expensive model).

2. **Heavy-reasoning token burn.** The orchestrator and especially the
   **renderer** run reasoning-class models. The renderer's job — emit one
   self-contained HTML file from a finished spec — is a generative *markup*
   task, not a reasoning task. A reasoning model here loops in chain-of-thought
   (the original symptom in [`fine-grained-model-selection`](../../../../../../openspec/changes/fine-grained-model-selection/proposal.md)),
   spending minutes and tokens before producing output.

3. **An LLM doing a deterministic job.** The **reporter** subagent uses an LLM
   to aggregate phase traces into `report.md` + `summary.json`. That is pure
   arithmetic and templating — correctness-critical, not generative. ADR 0001
   §2 and the github-pr-digest precedent make report assembly a **deterministic
   code tool**.

## What changes

### A. Adopt the shared kit (ADR 0001)

- Add `"shared": "*"` to `package.json`; remove the `#shared/*` relative imports
  map and the empty/duplicated `#lib/model.js` mapping.
- Replace `agent/lib/model.ts` with `import { resolveModel } from "shared/lib/model.js"`
  (no hard-coded default — unset role throws).
- Re-export the shared usage hook and `read_usage` tool by filename slug:
  `agent/hooks/usage.ts` and `agent/tools/read_usage.ts` become one-line
  re-exports of `shared/hooks/usage.js` / `shared/tools/read_usage.js`.
- Add `agent/tools/sync_run_to_host.ts` (re-export of the shared canonical
  copy-back) and make it the **final orchestrator step** — the diagram
  generator currently does **no** host copy-back (ADR 0001 §1), so runs are
  invisible on the host.
- Route run-artifact writes through `shared/lib/run.ts` (`writeRunArtifact`);
  keep `create_run` / `write_run_file` as thin agent-side wrappers.
- Delete the local `cost_rates` skill duplication; cost comes from
  `shared/cost/rates.yaml` via `shared/lib/cost.ts` + `buildRunSummary`.

### B. Rebalance deterministic vs. LLM (the "safe play")

This agent is **design-oriented**, so full determinism is neither possible nor
desirable — spec authoring and HTML art-direction are genuine generative
judgement. The split is drawn by *correctness vs. creativity*:

| Step | Today | After | Why |
|------|-------|-------|-----|
| Intake + Diagram Spec | LLM (orchestrator) | **LLM, bounded** | Generative judgement — keep, but cap reasoning + steps. |
| HTML render | LLM (reasoning) | **LLM, fast non-reasoning** | Generative markup — keep LLM, switch to a fast model + hard iteration cap. |
| Screenshot QC | tool | tool | Already deterministic. |
| Report + `summary.json` | **LLM (reporter subagent)** | **deterministic tool** (`render_and_save_report`) | Arithmetic/templating — move off the LLM entirely. |

- **Remove the `reporter` LLM subagent.** Replace it with a deterministic
  `render_and_save_report` tool (mirroring github-pr-digest) that reads the
  phase traces + `run-meta.json` and emits `report.md` + `summary.json` using
  `buildRunSummary`. Tools are kept for **simple, deterministic** items only.
- **Keep the `renderer` subagent** (it produces creative HTML), but pin it to a
  fast non-reasoning model and a strict iteration ceiling (≤ N screenshot
  retries) plus a wall-clock budget so it can never loop indefinitely.
- Add an orchestrator step/turn ceiling + wall-clock budget (shared usage hook
  soft-budget flag).

### C. Finalize models for the right job (GPT/OpenAI) — update `.env.example`

The diagram generator ships **no `.env.example`** today (only the README shows
z.ai/DeepSeek examples). Add one, standardized on **OpenAI**:

| Role | Model | Class | Rationale |
|------|-------|-------|-----------|
| `MODEL_ORCHESTRATOR` | `gpt-5.4-mini` | reasoning (light) + vision | Spec analysis & image OCR need reasoning + vision, but the full `gpt-5.4` over-thinks and burns tokens — `mini` is the right ceiling. |
| `MODEL_RENDERER` | `gpt-4o-mini` | fast, non-reasoning | Emits HTML directly without chain-of-thought loops; cheapest reliable markup model. |
| Reporter | — (none) | deterministic tool | No model — report assembly is code. |
| Diagram image (if used) | `gpt-image-2` | OpenAI image | Any rasterized/preview image generation uses the OpenAI image endpoint. |

All roles use `https://api.openai.com/v1` + `OPENAI_API_KEY` by default, still
overridable per role per ADR 0001 §4.

### D. Optimal skills

- Keep generative skills: `build_spec`, `design_system`, `render_diagram`,
  `prompt_template`. These carry the art-direction contract the LLM needs.
- **Retire** the LLM-facing reporting skills (`write_report`, `report_template`,
  `cost_rates`) — their logic moves into the deterministic report tool +
  shared cost matrix.
- Consolidate the duplicated per-subagent skill copies down to what each
  surviving role actually loads.

## Scope

### In scope
- Shared-kit adoption for diagram-generator.
- Removal of the reporter LLM subagent in favour of a deterministic report tool.
- Model rebalance to GPT/OpenAI + new `.env.example`.
- Renderer iteration/wall-clock guardrails.
- Skill consolidation.

### Out of scope
- Changing the diagram visual design language / `design_system` contract.
- Multi-page or animated diagrams.
- Replacing the renderer's generative HTML step with a deterministic templater
  (it is genuinely creative — kept as a bounded LLM step).

## Design principle

Correctness-critical and arithmetic steps are deterministic code tools; only
genuinely generative steps (spec authoring, HTML art-direction) remain LLM
steps, and those are bounded by model class, step ceiling, and wall-clock
budget. Per ADR 0001 §4 the agent stays model-agnostic and env-driven with no
hard-coded model id. Cost is observable per run via `summary.json` built from
the shared cost matrix (ADR 0002).
