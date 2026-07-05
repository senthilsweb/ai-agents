import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { OpenInferenceSimpleSpanProcessor } from "@arizeai/openinference-vercel";
import { registerOTel } from "@vercel/otel";
import {
  defineInstrumentation,
  type InstrumentationStepStartedEventInput,
} from "eve/instrumentation";

// ── Shared observability pipeline (common infra) ───────────────────────────
//
// See openspec change `add-agent-telemetry-and-observability`.
//
// One implementation of the OpenTelemetry pipeline for every agent in the
// monorepo: provider registration, OTLP export, OpenInference span mapping
// (so Arize Phoenix renders LLM traces natively), endpoint resolution, and
// privacy gating. Each agent adopts it with a thin `agent/instrumentation.ts`
// that calls `createAgentInstrumentation`, optionally passing agent-specific
// span attributes. Per-agent forks of this pipeline are not permitted.
//
// Env contract (identical for every agent; set once per environment):
//   PHOENIX_COLLECTOR_ENDPOINT    Phoenix base URL (e.g. http://localhost:6006)
//   OTEL_EXPORTER_OTLP_ENDPOINT   generic OTLP alternative
//   OTEL_EXPORTER_OTLP_HEADERS    standard `key=value,key2=value2` auth headers
//   TELEMETRY_RECORD_IO           "false" → omit prompts/completions on spans
//
// Both endpoint vars unset ⇒ telemetry fully off: setup registers nothing,
// and every custom-signal call (shared/lib/telemetry.ts) no-ops via the OTel
// global API. A configured-but-unreachable backend drops spans asynchronously
// inside the exporter and can never fail, slow-block, or alter a run.

export interface AgentInstrumentationOptions {
  /**
   * Extra per-model-call attributes merged into the AI SDK telemetry span's
   * runtime context. MUST be side-effect-free (env reads only) — this runs
   * on every step. Keys beginning with `eve.` are reserved and dropped.
   */
  attributes?: (
    input: InstrumentationStepStartedEventInput,
  ) => Record<string, string>;
}

function resolveEndpoint(): string | undefined {
  return (
    process.env.PHOENIX_COLLECTOR_ENDPOINT ??
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  );
}

/** Parse the standard OTLP headers form: `key=value,key2=value2`. */
function parseOtlpHeaders(raw: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!raw) return headers;
  for (const pair of raw.split(",")) {
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    headers[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return headers;
}

/**
 * Build the eve instrumentation definition for an agent. Export the result
 * as the default export of the agent's `agent/instrumentation.ts`.
 */
export function createAgentInstrumentation(
  options: AgentInstrumentationOptions = {},
) {
  const recordIO = process.env.TELEMETRY_RECORD_IO !== "false";

  return defineInstrumentation({
    setup: ({ agentName }) => {
      const endpoint = resolveEndpoint();
      // Present-or-absent gate (same principle as the OBJECT_STORE_* group):
      // no endpoint → register nothing → the agent runs exactly as before.
      if (!endpoint) {
        console.log(
          `[telemetry] ${agentName}: disabled (no PHOENIX_COLLECTOR_ENDPOINT / OTEL_EXPORTER_OTLP_ENDPOINT)`,
        );
        return;
      }
      const traceUrl = `${endpoint.replace(/\/$/, "")}/v1/traces`;
      console.log(
        `[telemetry] ${agentName}: exporting traces to ${traceUrl}` +
          (recordIO ? "" : " (prompt/completion recording off)"),
      );
      registerOTel({
        serviceName: agentName, // resolved by eve per agent; never hard-coded
        spanProcessors: [
          new OpenInferenceSimpleSpanProcessor({
            exporter: new OTLPTraceExporter({
              url: traceUrl,
              headers: parseOtlpHeaders(
                process.env.OTEL_EXPORTER_OTLP_HEADERS,
              ),
            }),
          }),
        ],
      });
    },

    recordInputs: recordIO,
    recordOutputs: recordIO,

    events: {
      "step.started"(input) {
        const extra = options.attributes?.(input);
        if (!extra || Object.keys(extra).length === 0) return undefined;
        return { runtimeContext: extra };
      },
    },
  });
}
