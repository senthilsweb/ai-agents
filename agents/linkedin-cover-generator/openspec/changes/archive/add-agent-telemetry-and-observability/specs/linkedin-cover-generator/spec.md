# LinkedIn Cover Generator Specification (delta)

> Conforms to [`ai-agents/openspec/adr/0001-shared-agent-runtime-kit.md`](../../../../../../openspec/adr/0001-shared-agent-runtime-kit.md).
> This delta adds OpenTelemetry trace export as **shared Agent Runtime Kit
> infrastructure**, adopted first by this agent, with Arize Phoenix as the
> documented default backend, plus a shared custom-signals API for
> need-basis logs, traces, and metrics from agent code. The cover generation
> pipeline, orchestrator procedure, usage hook, and report pipeline are
> unchanged and out of scope.

## ADDED Requirements

### Requirement: Provide the telemetry pipeline as shared-kit infrastructure

The system SHALL implement the observability pipeline once in the shared
Agent Runtime Kit, never per agent.

- Provider registration, OTLP export, OpenInference span mapping, endpoint
  resolution, and privacy gating SHALL live in
  `shared/lib/instrumentation.ts` as a `createAgentInstrumentation(options)`
  factory.
- Each adopting agent SHALL contain only a thin `agent/instrumentation.ts`
  that calls the shared factory (eve discovers this file per agent),
  optionally passing agent-specific span attributes; per-agent forks of the
  pipeline are not permitted.
- The env-var contract SHALL be identical for every agent, so an operator
  configures telemetry once per environment, not once per agent.

### Requirement: Export OpenTelemetry traces for every agent turn

The system SHALL emit an OpenTelemetry trace per agent turn — covering every
model call and tool call with timing, token usage, and session/turn/step
attributes — when a telemetry endpoint is configured.

- The exporter SHALL speak standard OTLP so that any OpenTelemetry-compatible
  backend can ingest the traces; Arize Phoenix SHALL be the documented
  default target.
- Exported spans SHALL carry OpenInference-mapped attributes (via an
  OpenInference span processor) so LLM-native backends render prompts,
  completions, token counts, and tool calls, while preserving the original
  AI SDK span attributes for non-OpenInference backends.
- The endpoint SHALL resolve from `PHOENIX_COLLECTOR_ENDPOINT` first, then
  `OTEL_EXPORTER_OTLP_ENDPOINT`; optional authentication headers SHALL come
  from the standard `OTEL_EXPORTER_OTLP_HEADERS` variable.
- When neither endpoint variable is set, `setup` SHALL register no tracer
  provider and every agent SHALL behave exactly as before this change. Local
  development SHALL NOT require any new configuration.
- A configured-but-unreachable backend SHALL NOT fail, slow-block, or alter
  any run: span export failures are dropped asynchronously and never
  propagate into the agent turn.

### Requirement: Provide a shared custom-signals API for need-basis telemetry

The system SHALL provide a shared API (`shared/lib/telemetry.ts`) through
which any agent's tools or library code can emit custom spans, structured
log events, and metrics when the automatic AI SDK spans are insufficient.

- The API SHALL expose at minimum: `withSpan(name, attributes, fn)` for
  custom spans that nest under the active span; `logEvent(name, attributes)`
  for structured events attached to the active span; and `counter(name)` /
  `histogram(name)` metric instruments.
- Every API call SHALL be a guaranteed no-op when no corresponding provider
  is registered (the OpenTelemetry global-API contract), so instrumented
  code SHALL NOT require feature flags or configuration guards.
- `withSpan` SHALL record exceptions on the span and re-throw the wrapped
  operation's original error, introducing no failure mode of its own.
- Agent code SHALL consume this API rather than importing OpenTelemetry
  packages directly, keeping the underlying SDK swappable in one place.
- This agent SHALL demonstrate the pattern by wrapping the image-generation
  API call in `generate_image` in a custom span
  (`cover.image_generation`), since that plain-HTTP call is invisible to the
  automatic AI SDK spans.

### Requirement: Enrich spans with agent-specific attributes

The system SHALL let each agent attach its own attributes to model-call
spans via the shared factory's `attributes` callback.

- This agent SHALL attach the configured orchestrator model id
  (`cover.orchestrator_model`) and image model id (`cover.image_model`).
- The callback SHALL be side-effect-free (env reads only) and SHALL NOT
  introduce a throw path into step execution.
- Framework-injected attributes (`eve.session.id`, `eve.turn.id`,
  `eve.step.index`, `eve.channel.kind`, …) SHALL be relied on as-is for
  trace navigation; the system SHALL NOT duplicate them.

### Requirement: Support privacy control over recorded content

The system SHALL allow operators to disable recording of prompt,
completion, and tool payload content on spans.

- Setting `TELEMETRY_RECORD_IO=false` SHALL set the AI SDK's `recordInputs`
  and `recordOutputs` to `false`, leaving structural spans (timing, tokens,
  span tree) intact while omitting message and payload content.
- The default (unset) SHALL be `true`, matching local-development
  expectations; the README SHALL direct deployed environments to set it to
  `false` unless the backend is approved for prompt/completion content.

### Requirement: Document the observability workflow

The system SHALL document how to run and use the telemetry pipeline.

- The README SHALL include the env-var contract, a copy-paste local Phoenix
  quickstart (Docker), one example configuration for a generic OTLP backend,
  and the one-file adoption recipe for other agents in the monorepo.
- The README SHALL document the custom-signals API with the
  `generate_image` exemplar.
- The README SHALL document how to correlate a run folder with its trace:
  `summary.json` → `perSession[].sessionId` → filter traces on
  `eve.session.id`.
- The README SHALL state the privacy implications of `recordInputs` /
  `recordOutputs` and the `TELEMETRY_RECORD_IO` toggle.

## Notes

This delta does not change:
- The single bounded LLM reasoning pass that authors `cover-spec.json`, nor
  any step of the orchestrator procedure.
- The shared usage hook (`shared/hooks/usage.ts`), soft budgets, cost matrix,
  or the deterministic `report.md` / `summary.json` pipeline — those remain
  the durable per-run record; traces are an additive, ambient layer.
- Other agents in the monorepo — they adopt later with their own thin
  `agent/instrumentation.ts`; metric/log **export** wiring is a follow-up
  (the API accepts those calls now and no-ops until a provider exists).
- Vercel's framework-owned `$eve.*` workflow run tags, which exist with or
  without this change.
