---
title: Run with Telemetry
description: Export OpenTelemetry traces to Arize Phoenix (or any OTLP backend) — setup, verification, custom spans, and privacy controls.
order: 2
updated: 2026-07-05
---

# Run with Telemetry

Traces answer "what happened inside this run, step by step": every model
call and tool call with prompts, completions, token counts, and latency —
plus custom spans for code the automatic instrumentation can't see (the
image-API call is the exemplar: ~88s in the last verified run, by far the
slowest step).

The pipeline is **shared-kit infra** (`shared/lib/instrumentation.ts`);
this agent's `agent/instrumentation.ts` is a ~5-line adapter. Telemetry is
**off by default** — it activates only when an endpoint is configured, and
an unreachable backend can never fail or slow a run.

> **Want the implementation details** — how spans actually get created and
> wired to Phoenix under the hood, the full eve lifecycle-hook vocabulary?
> See [Observability Internals](./observability-internals.md).

## 1. Start Phoenix (common infra, repo root)

```bash
cd <repo-root>
docker compose up -d        # service: ai-agents-phoenix
open http://localhost:6006  # traces UI
```

The compose file pins `platform: linux/amd64` — the arm64 image variant
crash-loops with SIGILL on Apple Silicon; the amd64 image under emulation
is stable. Traces persist in the `phoenix-data` volume.

## 2. Point the agent at it

In `agents/linkedin-cover-generator/.env`:

```dotenv
PHOENIX_COLLECTOR_ENDPOINT=http://localhost:6006
```

Restart `eve dev` (or let the `.env` watcher reload it — only between
runs!) and check the startup line:

```
[telemetry] linkedin-cover-generator: exporting traces to http://localhost:6006/v1/traces
[telemetry] linkedin-cover-generator: disabled (no PHOENIX_COLLECTOR_ENDPOINT / OTEL_EXPORTER_OTLP_ENDPOINT)
```

That line is the enabled/disabled source of truth. Any OTLP backend works
instead of Phoenix: set `OTEL_EXPORTER_OTLP_ENDPOINT` (plus
`OTEL_EXPORTER_OTLP_HEADERS=api_key=...` for hosted backends).

## 3. Run a cover and inspect the trace

Generate a cover, then open http://localhost:6006 → *default* project.
You should see the `ai.eve.turn` root span, `gen_ai` model-call spans
(prompts, completions, tokens), tool executions, the custom
`cover.image_generation` span, and even the object-store `http PUT` spans
when uploads are configured.

Programmatic check:

```bash
curl -s -X POST http://localhost:6006/graphql -H "Content-Type: application/json" \
  -d '{"query":"{ projects { edges { node { name traceCount tokenCountTotal } } } }"}'
```

**Correlate a run folder with its trace:** `summary.json` →
`perSession[].sessionId` → filter spans on `eve.session.id`.

## 4. Custom signals from code (need basis)

When the automatic spans aren't enough, emit your own through the shared
API — never import OpenTelemetry packages directly:

```ts
import { withSpan, logEvent, counter } from "shared/lib/telemetry.js";

const res = await withSpan("myagent.slow_thing", { key: "value" }, () => doIt());
logEvent("cache_miss", { key });
counter("myagent.retries").add(1);
```

Every call is a **guaranteed no-op when telemetry is off** (OTel global-API
contract) — no feature flags needed at call sites. `withSpan` records the
exception and re-throws; it adds no failure mode. See
`agent/tools/generate_image.ts` for the live exemplar.

## 5. Privacy

Spans record full prompts/completions by default. For deployed or
sensitive environments:

```dotenv
TELEMETRY_RECORD_IO=false
```

keeps the span tree, timing, and token counts while omitting message and
payload content. See [Secure the Endpoints](./secure-the-endpoints.md) for
the rest of the hardening checklist.

## Adopting in another agent

One file:

```ts
// agents/<name>/agent/instrumentation.ts
import { createAgentInstrumentation } from "shared/lib/instrumentation.js";
export default createAgentInstrumentation({
  attributes: () => ({ "myagent.model": process.env.MODEL_ORCHESTRATOR ?? "" }),
});
```

The env contract is identical for every agent — configure once per
environment, not per agent.
