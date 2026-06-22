# LinkedIn Cover Generator Specification (delta)

> Conforms to [`ai-agents/openspec/adr/0001-shared-agent-runtime-kit.md`](../../../../../../../../openspec/adr/0001-shared-agent-runtime-kit.md)
> and [`ai-agents/openspec/adr/0002-cost-matrix.md`](../../../../../../../../openspec/adr/0002-cost-matrix.md).
> This delta describes the linkedin-cover-generator after adopting the shared kit
> and rebalancing deterministic vs. LLM responsibilities. The cover visual
> language, palettes, presets, and layout rules are unchanged and out of scope.

## ADDED Requirements

### Requirement: Resolve models per role from environment (no default)

The system SHALL resolve every role's model from environment variables using the
shared resolver, and SHALL NOT hard-code any model id or provider.

- The orchestrator SHALL use a reasoning-capable, vision-capable model resolved
  from `MODEL_ORCHESTRATOR` for the single cover-spec authoring pass.
- Image generation SHALL use `IMAGE_MODEL` via the independent `IMAGE_*` vars.
- Each role SHALL resolve `MODEL_<ROLE>_* → MODEL_* →` an explicit startup
  failure when unset; there SHALL be no built-in default model id.
- The shipped `.env.example` SHALL default the orchestrator to `gpt-5.4-mini`
  and image generation to `gpt-image-2`, both on `https://api.openai.com/v1`.

### Requirement: Assemble the report deterministically

The system SHALL assemble `report.md` and `summary.json` with a deterministic
code tool (`render_and_save_report`), not an LLM subagent.

- The tool SHALL read the persisted `phases/*.json` and `run-meta.json` from the
  run directory.
- Timing, token totals, and cost SHALL derive only from the recorded phase
  traces via the shared `buildRunSummary` helper and the shared cost matrix.
- No reporter LLM subagent SHALL be invoked.

### Requirement: Emit run metrics

The system SHALL write `runs/<run-id>/summary.json` for every run.

- It SHALL record token usage (`input`, `output`, `total`, `by_phase`, `source`)
  from the shared usage hook.
- It SHALL record estimated cost (`currency`, `mode`, `total`, `by_phase`,
  `estimated`) computed from the shared cost matrix (ADR 0002).

### Requirement: Copy the run folder to the host

The system SHALL copy the run directory from the sandbox to the host workspace
with a single `sync_run_to_host` step as the final orchestrator action.

- The copy-back SHALL be backend-agnostic (sandbox read API, not `docker cp`)
  and idempotent.
- The previous `write_report` tool (which conflated copy-back with reporting)
  SHALL be removed.

## REMOVED Requirements

### Requirement: Reporter subagent aggregates metrics

**Reason**: Report assembly is arithmetic and templating, not generative — moved
to the deterministic `render_and_save_report` tool per ADR 0001 §2.
**Migration**: The orchestrator calls `render_and_save_report` instead of
delegating to the `reporter` subagent; the subagent and its `cost_rates` /
`report_template` skills are deleted.

## MODIFIED Requirements

### Requirement: Author the cover spec

The system SHALL author exactly one `cover-spec.json` with a single bounded LLM
reasoning pass.

- The orchestrator SHALL use `MODEL_ORCHESTRATOR` for this pass.
- The pass SHALL load the design skills (`art_direction`, `linkedin_layout`,
  `brand_safety`, `title_crafting`) and produce a spec matching the schema.
- The system SHALL NOT run an open-ended review loop; `review` and
  `retry_on_failure` remain opt-in and single-shot.
