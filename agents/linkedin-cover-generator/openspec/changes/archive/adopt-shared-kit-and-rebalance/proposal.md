# Proposal: Adopt the Shared Runtime Kit and Rebalance the LinkedIn Cover Generator

> **Status: Done** — implemented and verified 2026-06-22 (typecheck + `eve build`
> clean; all tasks complete). Archived.

> Conforms to [`ai-agents/openspec/adr/0001-shared-agent-runtime-kit.md`](../../../../../../openspec/adr/0001-shared-agent-runtime-kit.md)
> and [`ai-agents/openspec/adr/0002-cost-matrix.md`](../../../../../../openspec/adr/0002-cost-matrix.md).
> First kit consumer (reference implementation): [`agents/github-pr-digest`](../../../../../github-pr-digest).

## Why

The LinkedIn cover generator already draws a sensible deterministic/LLM line
("one reasoning pass for the cover spec, deterministic tools for everything
else"), but it still carries the cross-agent debt ADR 0001 targets and one
inconsistency:

1. **Duplicated runtime plumbing.** Model resolution, run-folder bookkeeping,
   `read_usage`, the usage hook, and sandbox bootstrap are re-implemented
   locally. `agent/lib/model.ts` hard-codes a **default model** (`glm-4.5-air`),
   which ADR 0001 §4 forbids.

2. **An LLM doing a deterministic job.** Step 9 still **delegates to a `reporter`
   LLM subagent** to aggregate phase traces into `report.md` + `summary.json`,
   even though that is pure arithmetic + templating. ADR 0001 §2 and the
   github-pr-digest precedent make report assembly a deterministic code tool.

3. **Model not finalized for the job.** Defaults point at z.ai GLM. The cover
   spec is a short, design-oriented reasoning pass and image generation is an
   OpenAI image call — both are better standardized on GPT/OpenAI.

This agent is **design-oriented**: title crafting, art direction, and layout are
genuine creative judgement, so the single bounded reasoning pass stays an LLM
step. The "safe play" is to keep that one creative pass and push everything
correctness-critical (prompt assembly, dimensions, validation, reporting,
copy-back) onto deterministic tools.

## What changes

### A. Adopt the shared kit (ADR 0001)

- Add `"shared": "*"` to `package.json`; remove the `#shared/*` relative imports
  map and the `#lib/model.js` mapping (keep the genuinely agent-specific
  `#lib/schemas.js`, `#lib/prompt-builder.js`, `#lib/palettes.js`,
  `#lib/presets.js`).
- Delete `agent/lib/model.ts`; switch `agent/agent.ts` to
  `resolveModel("orchestrator", …)` from `shared/lib/model.js` (no default).
- Re-export the shared usage hook + `read_usage` by filename slug.
- Replace the agent-specific `write_report.ts` (which today does the sandbox→host
  copy) with `agent/tools/sync_run_to_host.ts` (re-export of the shared
  canonical copy-back), and make it the final orchestrator step.
- Route run-artifact writes through `shared/lib/run.ts`.

### B. Rebalance deterministic vs. LLM (the "safe play")

| Step | Today | After | Why |
|------|-------|-------|-----|
| Cover Spec authoring | LLM (one pass) | **LLM (one pass)** | Creative judgement — keep, already bounded. |
| Load input / build prompt / dimensions / validate | tools | tools | Already deterministic. |
| Image generation | tool (OpenAI image API) | tool | Already deterministic. |
| Report + `summary.json` | **LLM (reporter subagent)** | **deterministic tool** (`render_and_save_report`) | Arithmetic/templating — move off the LLM. |

- **Remove the `reporter` LLM subagent.** Replace it with a deterministic
  `render_and_save_report` tool that reads the phase traces + `run-meta.json`
  and emits `report.md` + `summary.json` via `buildRunSummary`.
- Keep the single creative reasoning pass for `cover-spec.json`; keep the
  existing "no open-ended review loop" rule (`review` / `retry_on_failure`
  remain opt-in, single-shot).

### C. Finalize models for the right job (GPT/OpenAI) — update `.env.example`

| Role | Model | Class | Rationale |
|------|-------|-------|-----------|
| `MODEL_ORCHESTRATOR` | `gpt-5.4-mini` | reasoning (light) + vision | One short, design-oriented spec pass; vision for optional reference images. |
| `IMAGE_MODEL` | `gpt-image-2` | OpenAI image | The cover image itself. |
| Reporter | — (none) | deterministic tool | No model. |

All on `https://api.openai.com/v1` + `OPENAI_API_KEY` (orchestrator) /
`IMAGE_API_KEY` (image), still overridable per role per ADR 0001 §4. The
existing `.env.example` is rewritten from the z.ai/GLM defaults to this matrix.

### D. Optimal skills

- Keep the generative design skills: `art_direction`, `linkedin_layout`,
  `brand_safety`, `title_crafting`. These carry the creative contract for the
  one reasoning pass.
- **Retire** the reporter LLM skills (`cost_rates`, `report_template`) — their
  logic moves into the deterministic report tool + shared cost matrix.

## Scope

### In scope
- Shared-kit adoption for linkedin-cover-generator.
- Removal of the reporter LLM subagent in favour of a deterministic report tool.
- Model finalization to GPT/OpenAI + rewritten `.env.example`.
- Skill consolidation.

### Out of scope
- Changing the cover visual language, palettes, presets, or layout rules.
- Multi-image / carousel output.
- Replacing the single creative spec pass with a deterministic templater (it is
  genuinely creative — kept as a bounded LLM step).
- Reference-image editing (still an unimplemented provider-specific extension
  point in `generate_image.ts`; tracked separately).

## Design principle

Exactly one bounded creative LLM pass (the cover spec); everything
correctness-critical — input loading, prompt assembly, dimension snapping,
validation, reporting, and copy-back — is a deterministic code tool. The agent
stays model-agnostic and env-driven with no hard-coded model id (ADR 0001 §4),
and cost is observable per run via `summary.json` from the shared cost matrix
(ADR 0002).
