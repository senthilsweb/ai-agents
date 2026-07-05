# Shared Agent Runtime Kit

Cross-agent runtime building blocks for the `ai-agents` monorepo. See the ADRs:

- [`openspec/adr/0001-shared-agent-runtime-kit.md`](../openspec/adr/0001-shared-agent-runtime-kit.md)
- [`openspec/adr/0002-cost-matrix.md`](../openspec/adr/0002-cost-matrix.md)

## Consuming the kit

This is a **workspace package**. An agent depends on it and imports by subpath:

```jsonc
// agents/<agent>/package.json
"dependencies": { "shared": "*" }
```

```ts
import { resolveModel } from "shared/lib/model.js";
import { writeRunArtifact, syncRunToHost } from "shared/lib/run.js";
import { buildRunSummary } from "shared/lib/summary.js";
```

Use a workspace dependency, **not** a relative `#shared/*` imports map — Eve's
source snapshot follows workspace dependency symlinks but not bare relative
imports that escape the agent root (see ADR 0001 §1).

For Eve-discovered **tools** and **hooks**, add a one-line re-export under the
agent so Eve registers it by filename slug:

```ts
// agent/hooks/usage.ts
export { default } from "shared/hooks/usage.js";
// agent/tools/sync_run_to_host.ts
export { default } from "shared/tools/sync_run_to_host.js";
```

## Surface

| Path | Purpose |
|------|---------|
| `lib/model.ts` | `resolveModel(role)` — model-agnostic, env-driven, **no default** (unset role throws). |
| `lib/instrumentation.ts` | `createAgentInstrumentation()` — shared OTel pipeline (OTLP + OpenInference for Arize Phoenix), env-gated; agents adopt via a thin `agent/instrumentation.ts`. |
| `lib/telemetry.ts` | Need-basis custom signals: `withSpan`, `logEvent`, `counter`, `histogram` — guaranteed no-ops when telemetry is off. |
| `lib/run.ts` | `createRunId`, run-folder helpers, `writeRunArtifact` (host+sandbox mirror), `syncRunToHost`. |
| `lib/usage.ts` | Token-usage accumulator types + `readAllUsage` / `sumUsage`. |
| `lib/cost.ts` | Rate-card loader + `estimateCost` (per-token / per-request). |
| `lib/summary.ts` | `buildRunSummary()` → `summary.json` (tokens + cost + budget). |
| `hooks/usage.ts` | Usage accounting hook + soft step/wall-clock budget flag. |
| `tools/read_usage.ts` | Read accumulated usage for the current run. |
| `tools/sync_run_to_host.ts` | Canonical, backend-agnostic, idempotent end-of-run copy-back. |
| `tools/upload_run_to_object_store.ts` | Upload the whole run folder to an S3-compatible bucket (AWS S3 / MinIO); no-op unless `OBJECT_STORE_BUCKET` is set; patches `summary.json` with `artifacts.objectStore`. |
| `sandbox/base-sandbox.ts` | `createBaseSandbox()` — image pin + `.DS_Store` purge + extendable bootstrap. |
| `cost/rates.yaml` | Operator-populated, provider-agnostic cost matrix. |

## Configuration

Models are agnostic and resolved from `.env` per role: `MODEL_<ROLE>_*` →
`MODEL_*`. There is no built-in default model id. Optional cost/loop budgets:
`RUN_STEP_BUDGET`, `RUN_WALL_CLOCK_BUDGET_S`, and `COST_RATES_FILE`.

Optional, env-gated groups (both fully off when their vars are unset):
object storage (`OBJECT_STORE_BUCKET`, `OBJECT_STORE_REGION`,
`OBJECT_STORE_ACCESS_KEY_ID`, `OBJECT_STORE_SECRET_ACCESS_KEY`, optional
`OBJECT_STORE_ENDPOINT` / `OBJECT_STORE_FORCE_PATH_STYLE` /
`OBJECT_STORE_PUBLIC_BASE_URL`) and telemetry
(`PHOENIX_COLLECTOR_ENDPOINT` or `OTEL_EXPORTER_OTLP_ENDPOINT`, optional
`OTEL_EXPORTER_OTLP_HEADERS`, `TELEMETRY_RECORD_IO=false` to omit
prompts/completions on spans). See
[`agents/linkedin-cover-generator`](../agents/linkedin-cover-generator)
(first adopter) for usage docs.

First consumer: [`agents/github-pr-digest`](../agents/github-pr-digest).
