## ADDED Requirements

### Requirement: Per-role model configuration via environment variables

The agent system SHALL support configuring a separate LLM model, base URL,
and API key for each agent role (orchestrator, renderer, reporter) through
environment variables. Each role-specific variable SHALL fall back to the
corresponding global variable, which SHALL fall back to a hardcoded default.

The variable hierarchy SHALL be:
- `MODEL_ORCHESTRATOR` → `MODEL` → default
- `MODEL_ORCHESTRATOR_BASE_URL` → `MODEL_BASE_URL` → default
- `MODEL_ORCHESTRATOR_API_KEY` → `MODEL_API_KEY` → default
- `MODEL_RENDERER` → `MODEL` → default
- `MODEL_RENDERER_BASE_URL` → `MODEL_BASE_URL` → default
- `MODEL_RENDERER_API_KEY` → `MODEL_API_KEY` → default
- `MODEL_REPORTER` → `MODEL` → default
- `MODEL_REPORTER_BASE_URL` → `MODEL_BASE_URL` → default
- `MODEL_REPORTER_API_KEY` → `MODEL_API_KEY` → default

#### Scenario: All roles use the same model (backward compatible)
- **WHEN** only `MODEL`, `MODEL_BASE_URL`, and `MODEL_API_KEY` are set in `.env`
- **THEN** the orchestrator, renderer, and reporter all use the model specified by `MODEL`
- **AND** no per-role overrides are applied

#### Scenario: Orchestrator uses reasoning model, renderer uses fast model
- **WHEN** `MODEL=glm-4.5-air`, `MODEL_ORCHESTRATOR=glm-5.2` are set
- **THEN** the orchestrator uses `glm-5.2` for image analysis and spec writing
- **AND** the renderer subagent uses `glm-4.5-air` for HTML generation
- **AND** the reporter subagent uses `glm-4.5-air` for report generation

#### Scenario: Different providers per role
- **WHEN** `MODEL_ORCHESTRATOR=glm-5.2`, `MODEL_ORCHESTRATOR_BASE_URL=https://api.z.ai/api/paas/v4/`, `MODEL_ORCHESTRATOR_API_KEY=keyA`, `MODEL_RENDERER=deepseek-v4-pro`, `MODEL_RENDERER_BASE_URL=https://api.deepseek.com/v1`, `MODEL_RENDERER_API_KEY=keyB` are set
- **THEN** the orchestrator uses GLM-5.2 via z.ai
- **AND** the renderer uses DeepSeek via its own API
- **AND** each role authenticates with its own API key

### Requirement: Renderer subagent as a declared subagent

The renderer SHALL be implemented as a declared subagent at
`agent/subagents/renderer/` with its own `agent.ts` that constructs a model
from the `MODEL_RENDERER*` environment variables. The renderer SHALL have
its own `skills/`, `tools/`, `hooks/`, and `instructions.md`.

#### Scenario: Orchestrator delegates rendering to renderer subagent
- **WHEN** the orchestrator has written `spec.json` to the run directory and is ready to render
- **THEN** the orchestrator calls the `subagent` tool with `subagentName: "renderer"`
- **AND** the message includes the full spec JSON content and the run directory path
- **AND** the renderer subagent uses the model configured by `MODEL_RENDERER*` env vars

#### Scenario: Renderer writes diagram HTML
- **WHEN** the renderer has generated the HTML diagram
- **THEN** the renderer writes `diagram-light.html` to its own sandbox's `runs/<run_id>/` directory
- **AND** the renderer returns the full HTML content in its response message to the orchestrator
- **AND** the orchestrator writes the HTML to its own sandbox's `runs/<run_id>/` directory

### Requirement: Reporter subagent as a declared subagent

The reporter SHALL be implemented as a declared subagent at
`agent/subagents/reporter/` with its own `agent.ts` that constructs a model
from the `MODEL_REPORTER*` environment variables. The reporter SHALL have
its own `skills/`, `tools/`, `hooks/`, and `instructions.md`.

#### Scenario: Orchestrator delegates report writing to reporter subagent
- **WHEN** the orchestrator has the rendered diagram and phase traces
- **THEN** the orchestrator calls the `subagent` tool with `subagentName: "reporter"`
- **AND** the message includes the phase traces, token usage data, and run metadata
- **AND** the reporter subagent uses the model configured by `MODEL_REPORTER*` env vars

### Requirement: Token usage capture for declared subagents

Each declared subagent SHALL include a copy of the usage hook
(`agent/subagents/<id>/hooks/usage.ts`) that captures `step.completed`
usage events and writes them to `$TMPDIR/eve-usage/<sessionId>.json`. This
ensures token/cost observability is maintained across all roles, even
though declared subagent sessions do not trigger the parent agent's hooks.

#### Scenario: Renderer subagent usage is captured
- **WHEN** the renderer subagent completes a step
- **THEN** the renderer's usage hook writes token counts to `$TMPDIR/eve-usage/<rendererSessionId>.json`
- **AND** the orchestrator can read this data via the `read_usage` tool after the renderer returns

#### Scenario: All roles have usage data
- **WHEN** a full run completes (orchestrator + renderer + reporter)
- **THEN** `read_usage` returns token counts for all three session IDs
- **AND** each session's data includes `inputTokens`, `outputTokens`, `cacheReadTokens`, `steps`, and `updatedAt`

### Requirement: Artifact exchange via message passing

Artifacts (spec JSON, HTML diagram, phase traces) SHALL be passed in full via subagent delegation messages, because declared subagents have isolated sandboxes and cannot read files written by the orchestrator. The receiving subagent SHALL write received content to its own sandbox via `write_run_file`, and SHALL return its output content in its response message for the orchestrator to persist.

#### Scenario: Spec is passed to renderer
- **WHEN** the orchestrator delegates to the renderer
- **THEN** the delegation message includes the full spec JSON (not just the file path)
- **AND** the renderer writes the spec to its own sandbox before processing it

#### Scenario: HTML is returned from renderer
- **WHEN** the renderer finishes generating the HTML diagram
- **THEN** the renderer's response message includes the full HTML content
- **AND** the orchestrator writes the HTML to its own sandbox via `write_run_file`

### Requirement: Updated .env.example with per-role variables

The `.env.example` file SHALL document all per-role model variables with
comments explaining the fallback hierarchy and example configurations for
common scenarios (same model for all roles, reasoning orchestrator + fast
renderer, different providers per role).

#### Scenario: User reads .env.example
- **WHEN** a user opens `.env.example`
- **THEN** they see `MODEL_ORCHESTRATOR*`, `MODEL_RENDERER*`, `MODEL_REPORTER*` variables documented
- **AND** they see the fallback hierarchy explained
- **AND** they see example configurations for the common use cases
