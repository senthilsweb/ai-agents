# Diagram Generator Specification (delta)

> Conforms to [`ai-agents/openspec/adr/0001-shared-agent-runtime-kit.md`](../../../../../../../../openspec/adr/0001-shared-agent-runtime-kit.md)
> and [`ai-agents/openspec/adr/0002-cost-matrix.md`](../../../../../../../../openspec/adr/0002-cost-matrix.md).
> This delta describes the diagram-generator after adopting the shared kit and
> rebalancing deterministic vs. LLM responsibilities. The visual design contract
> (`design_system`) is unchanged and out of scope.

## ADDED Requirements

### Requirement: Resolve models per role from environment (no default)

The system SHALL resolve every role's model from environment variables using the
shared resolver, and SHALL NOT hard-code any model id or provider.

- The orchestrator SHALL use a reasoning-capable, vision-capable model resolved
  from `MODEL_ORCHESTRATOR`.
- The renderer SHALL use a fast, non-reasoning model resolved from
  `MODEL_RENDERER`, because HTML generation is a markup task; a reasoning model
  here is prohibited as it risks runaway chain-of-thought.
- Optional rasterized/preview image generation SHALL use `IMAGE_MODEL`.
- Each role SHALL resolve `MODEL_<ROLE>_* → MODEL_* →` an explicit startup
  failure when unset; there SHALL be no built-in default model id.
- The shipped `.env.example` SHALL default every role to an OpenAI model on
  `https://api.openai.com/v1` (`gpt-5.4-mini` orchestrator, `gpt-4o-mini`
  renderer, `gpt-image-2` image).

### Requirement: Assemble the report deterministically

The system SHALL assemble `report.md` and `summary.json` with a deterministic
code tool (`render_and_save_report`), not an LLM subagent.

- The tool SHALL read the persisted `phases/*.json` and `run-meta.json` from the
  run directory.
- Timing, token totals, and cost SHALL derive only from the recorded phase
  traces via the shared `buildRunSummary` helper and the shared cost matrix.
- The orchestrator SHALL NOT compose, summarize, or rewrite the report itself.
- No reporter LLM subagent SHALL be invoked.

### Requirement: Emit run metrics

The system SHALL write `runs/<run-id>/summary.json` for every run.

- It SHALL record token usage (`input`, `output`, `total`, `by_phase`, `source`)
  from the shared usage hook.
- It SHALL record estimated cost (`currency`, `mode`, `total`, `by_phase`,
  `estimated`) computed from the shared cost matrix (ADR 0002).
- When a run is aborted by a loop or wall-clock budget, `summary.json` SHALL
  still be written with `source: "partial"`.

### Requirement: Copy the run folder to the host

The system SHALL copy the run directory from the sandbox to the host workspace
with a single `sync_run_to_host` step as the final orchestrator action.

- Deterministic tools SHALL NOT write to the host directly.
- The copy-back SHALL be backend-agnostic (sandbox read API, not `docker cp`)
  and idempotent.

### Requirement: Bound renderer and orchestrator cost

The system SHALL bound runtime cost and prevent infinite loops.

- The renderer SHALL cap self-verification at `RENDER_MAX_ITERATIONS`
  (default 4) screenshot retries and a per-render wall-clock budget; on exceed
  it SHALL record `qc.passed: false` and continue.
- The orchestrator SHALL enforce a step/turn ceiling (`RUN_STEP_BUDGET`) and a
  wall-clock budget (`RUN_WALL_CLOCK_BUDGET_S`).

## REMOVED Requirements

### Requirement: Reporter subagent aggregates metrics

**Reason**: Report assembly is arithmetic and templating, not generative — moved
to the deterministic `render_and_save_report` tool per ADR 0001 §2.
**Migration**: The orchestrator calls `render_and_save_report` instead of
delegating to the `reporter` subagent; the subagent and its
`write_report` / `report_template` / `cost_rates` skills are deleted.

## MODIFIED Requirements

### Requirement: Render the HTML diagram

The renderer subagent SHALL produce one self-contained HTML diagram from the
finished Diagram Spec, following the `design_system` contract.

- The renderer SHALL run a fast, non-reasoning model (`MODEL_RENDERER`).
- The renderer SHALL self-verify with a headless screenshot up to
  `RENDER_MAX_ITERATIONS` times, then stop.
- The renderer SHALL receive the full spec inline in the delegation message
  (isolated sandbox) and return the HTML content in its response; the
  orchestrator SHALL write the returned HTML to the run folder.
