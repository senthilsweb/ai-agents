# Proposal: Add Agent Telemetry and Observability (Shared OpenTelemetry Infra + Arize Phoenix)

> Conforms to [`ai-agents/openspec/adr/0001-shared-agent-runtime-kit.md`](../../../../../openspec/adr/0001-shared-agent-runtime-kit.md).
> Complements [`store-run-artifacts-in-object-storage`](../store-run-artifacts-in-object-storage/proposal.md)
> (proposed): that change makes run *artifacts* durable and retrievable;
> this one makes run *behavior* — every model call, tool call, token count,
> and latency — inspectable in an LLM-tracing backend.

## Why

Today the only observability the agents have is what the shared kit writes
to disk:

- `shared/hooks/usage.ts` accumulates per-session token totals and a **soft**
  step / wall-clock budget flag under `<tmpdir>/eve-usage/<sessionId>.json`.
- `render_and_save_report` folds those totals into `report.md` /
  `summary.json` **after the run finishes**.

That is a *post-hoc, per-run rollup*. It cannot answer the questions that
come up while developing prompts or diagnosing a bad run:

- Which step burned the tokens? What did the orchestrator actually send and
  receive on the pass that authored `cover-spec.json`?
- Why did a run take 2 minutes — model latency, tool latency, or the image
  API? Where did retries happen?
- Did the model deviate from the documented procedure (extra tool calls,
  skipped validation, an unexpected review loop)?
- How did behavior change between orchestrator models (e.g. `gpt-5.4-mini`
  vs `claude-sonnet-5`, which we A/B-tested on 2026-07-05) or between prompt
  revisions?

eve already has a first-class answer: an auto-discovered
`agent/instrumentation.ts` that registers an OpenTelemetry provider at server
startup, after which the framework emits a full trace per turn
(`ai.eve.turn` → `ai.streamText` steps → `ai.toolCall` spans). We are simply
not using it — and since every agent in this monorepo would need the exact
same wiring, the wiring belongs in the **shared Agent Runtime Kit**, not in
any one agent.

[Arize Phoenix](https://phoenix.arize.com/) is the proposed default backend:
open-source, self-hostable with one Docker container, speaks OTLP, and
renders LLM traces (prompts, completions, token counts, tool calls) natively
via its OpenInference conventions. Because the export path is plain
OpenTelemetry, any OTLP backend (Grafana Tempo, Jaeger, Datadog, Braintrust,
Honeycomb) works with the same code by pointing the standard `OTEL_*` env
vars somewhere else — Phoenix is a default, not a lock-in.

## What changes

Two shared-kit modules plus a thin per-agent adoption file:

- **`shared/lib/instrumentation.ts` (common infra)** — a
  `createAgentInstrumentation(options)` factory that returns an eve
  `defineInstrumentation` result:
  - registers an OTel tracer provider (`@vercel/otel`) with an OTLP trace
    exporter and an OpenInference span processor
    (`@arizeai/openinference-vercel`) so AI SDK spans render as LLM traces
    in Phoenix, not as opaque generic spans;
  - is **env-gated**: when no OTLP endpoint is configured, it registers
    nothing and the agent behaves exactly as today (same present-or-absent
    principle as the `OBJECT_STORE_*` group);
  - wires `recordInputs` / `recordOutputs` to a `TELEMETRY_RECORD_IO` env
    var (privacy toggle);
  - accepts an optional `attributes` callback so each agent can add its own
    per-model-call runtime-context attributes.
- **`shared/lib/telemetry.ts` (custom signals, on a need basis)** — a small
  API over `@opentelemetry/api` that any tool or lib code in any agent can
  call to emit **custom spans, span events (logs), and metrics** when the
  automatic AI SDK spans aren't enough: `withSpan(name, attrs, fn)`,
  `logEvent(name, attrs)`, `counter(name)` / `histogram(name)`. Every call
  is a **guaranteed no-op** when no provider is registered (the OTel global
  API's contract), so instrumented code needs no feature flags.
- **Per-agent adoption (this agent first)** — `agent/instrumentation.ts`
  becomes a ~5-line call to `createAgentInstrumentation({...})` passing
  cover-specific attributes (orchestrator/image model ids); and
  `generate_image` demonstrates need-basis custom signals by wrapping its
  image-API `fetch` in `withSpan("cover.image_generation", ...)` — that call
  is invisible to the automatic AI SDK spans today because it is a plain
  HTTP request, yet it is usually the slowest and most expensive step.
- README documentation: env contract, local Phoenix quickstart
  (`docker run arizephoenix/phoenix`), the custom-signals API, and how other
  agents adopt in one file.

No change to the existing usage hook, soft budgets, or the deterministic
report pipeline — traces are additive; `report.md` / `summary.json` remain
the durable per-run record.

## Scope

### In scope
- `shared/lib/instrumentation.ts` — the `createAgentInstrumentation` factory
  (OTLP + OpenInference, env-gated, backend-agnostic).
- `shared/lib/telemetry.ts` — the custom-signals API (spans, span events,
  counters/histograms) usable from any agent's tools/libs on a need basis.
- First adoption in `linkedin-cover-generator`: `agent/instrumentation.ts`
  wrapper + one exemplar custom span in `generate_image`.
- Privacy toggles for recording prompts/completions on spans.
- README documentation: env contract, local Phoenix quickstart, adoption
  guide for other agents, custom-signals usage.

### Out of scope
- Changing or replacing the shared usage hook, cost matrix, or the
  deterministic `render_and_save_report` pipeline.
- Registering metric/log **exporters** — the custom-signals API accepts
  metric and log-style calls now (no-op until a meter/logger provider is
  registered); wiring their export pipelines is a follow-up once a concrete
  dashboard need exists. Traces export end-to-end in this change.
- Phoenix evals, datasets, prompt-management, or any Phoenix feature beyond
  trace ingestion and viewing.
- Rolling adoption out to the other agents (diagram-generator,
  api-test-generator, github-pr-digest, job-scout) — each is a ~5-line
  follow-up once the pattern is proven here.
- Vercel's dashboard-side "Agent Runs" tab and `$eve.*` workflow run tags —
  framework-owned, automatic, and not configurable from this repo.
- Alerting/SLOs on top of the exported traces.

## Design principle

Observability must be a **zero-cost, zero-risk overlay** and a **shared-kit
concern**: the pipeline (provider registration, exporter, span mapping,
privacy gates) is common infra implemented once in `shared/` — never forked
per agent — while *what* each agent additionally emits (custom spans, log
events, metrics) is that agent's decision, made in its own code on a need
basis through a stable no-op-safe API. No LLM involvement, no new
orchestrator steps, and a hard guarantee that an unset or unreachable
telemetry backend can never fail a run. Local dev with no configuration
behaves byte-for-byte as today. The export contract is standard
OpenTelemetry so the backend is swappable via env vars alone — consistent
with ADR 0001's "model-agnostic, env-driven, no built-in default" stance,
applied to observability.
