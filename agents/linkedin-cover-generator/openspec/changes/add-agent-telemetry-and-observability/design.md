# Design: Add Agent Telemetry and Observability (Shared OpenTelemetry Infra + Arize Phoenix)

> Conforms to [`ai-agents/openspec/adr/0001-shared-agent-runtime-kit.md`](../../../../../openspec/adr/0001-shared-agent-runtime-kit.md).

## 1. What exists today

Three observability layers already touch the agents; only the third is new.

```
Layer 1 — per-run rollup (exists, unchanged):
  shared/hooks/usage.ts  →  <tmpdir>/eve-usage/<sessionId>.json
        │  render_and_save_report (deterministic)
        ▼
  runs/<id>/report.md + summary.json     (tokens, steps, soft budget, cost)

Layer 2 — framework workflow tags (exists, automatic, not configurable):
  $eve.type / $eve.root / $eve.model / $eve.input_tokens / ...
        → Vercel Workflow dashboard ("Agent Runs" tab when deployed)

Layer 3 — OpenTelemetry traces + custom signals (NEW, this change):
  shared/lib/instrumentation.ts  (pipeline: provider, exporter, mapping)
  shared/lib/telemetry.ts        (custom spans / events / metrics API)
        │  per-agent: agent/instrumentation.ts (~5-line wrapper)
        ▼
  OTLP  →  Arize Phoenix (default) or any OTel backend
```

Layer 1 answers "what did this run cost in total". Layer 3 answers "what
happened, step by step, inside this run" — full span tree with prompts,
completions, tool inputs/outputs, per-step tokens, and wall-clock timing.

## 2. How eve exposes it

eve auto-discovers `agent/instrumentation.ts` **per agent** and runs it at
server startup, before any agent code — this is why a thin per-agent file
must exist even though all logic is shared. Per turn, the framework emits:

```
ai.eve.turn  {eve.session.id, eve.turn.id, eve.step.index, eve.channel.kind}
  ├── ai.streamText                       step 1 (orchestrator pass)
  │     ├── ai.streamText.doStream        model call → tokens, latency
  │     └── ai.toolCall {toolName: create_run}
  ├── ai.streamText                       step 2
  │     └── ai.toolCall {toolName: generate_image}
  │           └── cover.image_generation  ← custom span (shared/lib/telemetry)
  ├── ...
  └── ai.streamText                       final text
```

The framework half of the runtime context (`eve.version`, `eve.session.id`,
`eve.environment`, `eve.turn.id`, `eve.turn.sequence`, `eve.step.index`,
`eve.channel.kind`) is injected automatically; whatever the per-agent
`attributes` callback returns rides onto the same spans. Custom spans opened
via `withSpan` inside a tool nest under that tool's `ai.toolCall` span
through normal OTel context propagation.

## 3. Shared module 1: `shared/lib/instrumentation.ts` (common pipeline)

```ts
// shared/lib/instrumentation.ts  (sketch — final code in implementation)
import { defineInstrumentation } from "eve/instrumentation";
import { registerOTel } from "@vercel/otel";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { OpenInferenceSimpleSpanProcessor } from "@arizeai/openinference-vercel";

export interface AgentInstrumentationOptions {
  /** Extra per-model-call attributes; merged into runtimeContext. Env reads only. */
  attributes?: (input: StepStartedInput) => Record<string, string>;
}

export function createAgentInstrumentation(
  options: AgentInstrumentationOptions = {},
) {
  const endpoint =
    process.env.PHOENIX_COLLECTOR_ENDPOINT ??
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  return defineInstrumentation({
    // Present-or-absent gate: no endpoint → register nothing → agent runs
    // exactly as before. Mirrors the OBJECT_STORE_* group's no-op contract.
    setup: ({ agentName }) => {
      if (!endpoint) return;
      registerOTel({
        serviceName: agentName, // resolved by eve per agent; never hard-coded
        spanProcessors: [
          new OpenInferenceSimpleSpanProcessor({
            exporter: new OTLPTraceExporter({
              url: `${endpoint.replace(/\/$/, "")}/v1/traces`,
              headers: parseOtlpHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS),
            }),
          }),
        ],
      });
    },

    // Privacy toggles (AI SDK record flags; default true, README documents
    // setting TELEMETRY_RECORD_IO=false for deployed / sensitive envs).
    recordInputs: process.env.TELEMETRY_RECORD_IO !== "false",
    recordOutputs: process.env.TELEMETRY_RECORD_IO !== "false",

    events: {
      "step.started"(input) {
        const extra = options.attributes?.(input) ?? {};
        return { runtimeContext: { ...extra } };
      },
    },
  });
}
```

Per-agent adoption is one small file (eve requires it to exist per agent):

```ts
// agents/linkedin-cover-generator/agent/instrumentation.ts
import { createAgentInstrumentation } from "shared/lib/instrumentation.js";

export default createAgentInstrumentation({
  attributes: () => ({
    "cover.orchestrator_model": process.env.MODEL_ORCHESTRATOR ?? "",
    "cover.image_model": process.env.IMAGE_MODEL ?? "",
  }),
});
```

Notes:

- **OpenInference processor, not a bare exporter.** Phoenix renders LLM
  traces (prompt/completion panes, token columns, tool-call views) from
  OpenInference semantic conventions. `@arizeai/openinference-vercel`'s span
  processor maps the AI SDK's `ai.*` span attributes onto those conventions
  at export time. Backends that read raw AI SDK attributes (Braintrust,
  Datadog LLM Obs) still work — the original attributes are preserved.
- **Endpoint resolution order** — `PHOENIX_COLLECTOR_ENDPOINT` (Phoenix
  convention) first, then the standard `OTEL_EXPORTER_OTLP_ENDPOINT`. Either
  alone is sufficient; both unset means telemetry is off.
- **Run-id correlation.** The run folder id (`runs/<run-id>/`) is created
  mid-turn by `create_run`, after `setup` has long finished, so it cannot be
  a resource attribute. Correlation is by `eve.session.id`: `run-meta.json`
  already records the session, and `summary.json` records per-session ids.

## 4. Shared module 2: `shared/lib/telemetry.ts` (custom signals, need basis)

The pipeline above captures everything the AI SDK sees. It does **not** see
plain code: `generate_image`'s image-API `fetch`, sandbox file I/O, retry
loops. When an agent needs visibility there, it emits custom signals through
a stable shared API rather than touching OTel packages directly:

```ts
// shared/lib/telemetry.ts  (sketch)
import { trace, metrics, SpanStatusCode } from "@opentelemetry/api";

const tracer = () => trace.getTracer("ai-agents.shared");

/** Wrap any async operation in a custom span (nests under the active span). */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: () => Promise<T>,
): Promise<T> { /* start span → run fn → record exception + status → end */ }

/** Structured log event attached to the currently active span. */
export function logEvent(
  name: string,
  attributes?: Record<string, string | number | boolean>,
): void { /* addEvent on the active span; no-op when none */ }

/** Metric instruments (no-op until a meter provider is registered). */
export function counter(name: string): Counter { /* metrics.getMeter(...) */ }
export function histogram(name: string): Histogram { /* ... */ }
```

Guarantees:

- **No-op by contract.** All functions route through the OTel global API,
  which returns no-op tracers/meters when no provider is registered. Code
  instrumented with `withSpan` / `logEvent` / `counter` needs no `if
  (telemetryEnabled)` guards anywhere.
- **No throw path.** `withSpan` records exceptions on the span and re-throws
  the original error — it never introduces its own failure mode; `logEvent`
  and metric calls swallow nothing because they have nothing to fail on.
- **Traces export today; metrics/logs are forward-compatible.** This change
  registers a tracer provider only. `counter`/`histogram`/`logEvent` calls
  are valid immediately (span events do export, riding on spans) and metric
  export lights up later by registering a meter provider in
  `createAgentInstrumentation` — no call-site changes.

Exemplar adoption (this change, `generate_image`):

```ts
const res = await withSpan(
  "cover.image_generation",
  { "cover.image_model": model, "cover.width": w, "cover.height": h },
  () => fetch(`${base}/images/generations`, { ... }),
);
```

## 5. Environment contract

| Env var | Required | Notes |
|---|---|---|
| `PHOENIX_COLLECTOR_ENDPOINT` | no* | Phoenix base URL, e.g. `http://localhost:6006`. Kit appends `/v1/traces`. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | no* | Generic OTLP alternative (Tempo, Jaeger, Datadog agent, collector). Same append rule. |
| `OTEL_EXPORTER_OTLP_HEADERS` | no | Standard OTel `key=value,key2=value2` form — API keys for hosted backends (e.g. `api_key=...` for hosted Phoenix / Arize). |
| `TELEMETRY_RECORD_IO` | no | `false` disables recording prompts/completions/tool payloads on spans. Default `true` (local dev). |

\* Neither is required; **both unset ⇒ telemetry fully off** (setup registers
no provider, and every custom-signal call is a no-op). One of the two must
be set to export anywhere. The contract is identical for every agent — set
once per environment, not per agent.

## 6. Local Phoenix quickstart (README content)

```bash
docker run -d --name phoenix -p 6006:6006 arizephoenix/phoenix:latest
echo 'PHOENIX_COLLECTOR_ENDPOINT=http://localhost:6006' >> .env
npx eve dev --port 3535
# run a cover generation, then open http://localhost:6006 → traces
```

Deployed on Vercel: set `PHOENIX_COLLECTOR_ENDPOINT` (or
`OTEL_EXPORTER_OTLP_ENDPOINT`) + `OTEL_EXPORTER_OTLP_HEADERS` via
`vercel env add`, and set `TELEMETRY_RECORD_IO=false` unless the backend is
approved for prompt/completion content.

## 7. Failure-isolation guarantees

- Endpoint unset → `setup` registers nothing; custom-signal calls no-op via
  the OTel global API. Zero new behavior without configuration.
- Endpoint configured but unreachable → OTLP export fails asynchronously
  inside the exporter; spans are dropped and the failure never propagates
  into the agent turn. No retry storms: the simple span processor drops on
  failure rather than queueing unboundedly.
- The `attributes` callback contract is env-reads-only — no I/O, no throw
  path that can abort a step; `withSpan` re-throws only the wrapped
  operation's own errors.

## 8. File-by-file impact

### Added (shared kit)
- `shared/lib/instrumentation.ts` — `createAgentInstrumentation` factory.
- `shared/lib/telemetry.ts` — custom-signals API (`withSpan`, `logEvent`,
  `counter`, `histogram`).

### Modified (shared kit)
- `shared/package.json` — add `@vercel/otel`, `@opentelemetry/api`,
  `@opentelemetry/exporter-trace-otlp-proto`,
  `@arizeai/openinference-vercel`; add both new modules to the `exports` map.

### Added (this agent, first adopter)
- `agent/instrumentation.ts` — ~5-line `createAgentInstrumentation` call
  with cover-specific attributes.

### Modified (this agent)
- `agent/tools/generate_image.ts` — wrap the image-API call in
  `withSpan("cover.image_generation", ...)` (exemplar need-basis signal).
- `.env.example` — commented telemetry block (off by default).
- `README.md` — "Observability" section: env contract, Phoenix quickstart,
  custom-signals API, adoption guide for other agents, privacy note.

### Unchanged
- `shared/hooks/usage.ts`, soft budgets, `shared/cost/rates.yaml`, and the
  deterministic report pipeline — Layer 1 stays the durable per-run record.
- `agent/instructions.md` — **no new orchestrator steps**; telemetry is
  ambient, not procedural.
- Other agents — they adopt later with their own ~5-line
  `agent/instrumentation.ts`; nothing changes for them in this delta.

## 9. Relationship to `store-run-artifacts-in-object-storage`

Independent and composable — and both follow the same shared-kit shape:
one implementation in `shared/`, per-agent adoption via a thin file, an
env-gated no-op default. Artifacts-in-S3 makes run *outputs* durable; this
change makes run *execution* inspectable. If both land, a debugging session
looks like: `summary.json` (from the bucket) → `perSession[].sessionId` →
Phoenix filter `eve.session.id = ...` → full trace of the run that produced
those artifacts.
