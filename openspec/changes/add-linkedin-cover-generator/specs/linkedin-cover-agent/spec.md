# LinkedIn Cover Agent Specification

## Requirement: Input sources
The agent SHALL accept a local article path, an HTTP/HTTPS URL, or inline article text.

## Requirement: Canvas
The default canvas SHALL be 1280x720 (divisible by 16 for image API compatibility). Named presets and explicit WIDTHxHEIGHT values SHALL be supported.

## Requirement: Minimal model calls
A normal run SHALL use no more than one orchestrator reasoning call and one image generation call. Review SHALL be opt-in and limited to one call.

## Requirement: No unbounded loops
The agent SHALL NOT perform open-ended regeneration. A retry SHALL be opt-in, hard-failure-only, and limited to one.

## Requirement: Brand safety
Company names, product names, logos, and links SHALL be excluded unless explicitly requested.

## Requirement: Deterministic validation
The output image dimensions SHALL be validated without an LLM. A mismatch SHALL be reported as a hard failure. A tolerance of 16px per dimension SHALL be allowed to accommodate image API rounding to 16-divisible dimensions.

## Requirement: Approval mode
When approval is enabled, the agent SHALL persist a proposal and Cover Spec and stop before image generation.

## Requirement: Orchestrator + Reporter architecture
The agent SHALL use an orchestrator model for spec creation and prompt building, and a reporter subagent for metrics aggregation. The reporter SHALL produce `report.md` and `summary.json` with timing, token, and cost data from phase traces. The reporter SHALL be a declared subagent with its own isolated sandbox, receiving all data inline from the orchestrator.

## Requirement: Phase traces
The orchestrator SHALL write a phase trace JSON file per phase (`orchestrate.json`, `generate.json`, `validate.json`) to `<run_dir>/phases/`. Each trace SHALL contain: phase name, model id, started_at, ended_at, duration_s, and tokens (input, output, total, source). The reporter SHALL write its own `report.json` phase trace.

## Requirement: Fine-grained model selection
The agent SHALL support per-role model configuration via `MODEL_ORCHESTRATOR*`, `MODEL_REPORTER*`, and `IMAGE_*` environment variables, each with fallback to generic `MODEL*` vars. This enables using a reasoning model for orchestration and a fast, cheap model for reporting.

## Requirement: Usage tracking
The agent SHALL include a usage hook that accumulates token consumption (input, output, cache read, cache write) per session. A `read_usage` tool SHALL expose this data for inclusion in phase traces and reports.

## Requirement: Cost reporting
The reporter SHALL compute token cost when `ALLOW_COST=true`, using a rate-card skill. Cost SHALL be marked `n/a` when rates are unavailable, `ALLOW_COST=false`, or the model is an image model (per-image pricing, not per-token). All cost figures SHALL be marked as estimates.
