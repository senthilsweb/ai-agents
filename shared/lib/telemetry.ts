import {
  metrics,
  trace,
  SpanStatusCode,
  type Attributes,
  type Counter,
  type Histogram,
} from "@opentelemetry/api";

// ── Custom telemetry signals (need-basis API) ──────────────────────────────
//
// See openspec change `add-agent-telemetry-and-observability`.
//
// The shared instrumentation pipeline (shared/lib/instrumentation.ts)
// captures everything the AI SDK sees: model calls and tool calls. It does
// NOT see plain code — an image-API fetch, sandbox file I/O, a retry loop.
// When an agent needs visibility there, it emits custom signals through this
// API rather than importing OpenTelemetry packages directly.
//
// Every function here routes through the OTel *global* API, which returns
// no-op tracers/meters when no provider is registered. That makes every call
// a guaranteed no-op with telemetry off — instrumented code needs no feature
// flags or configuration guards, and `withSpan` never introduces a failure
// mode of its own (it records the wrapped operation's exception and
// re-throws the original error).

const TRACER_NAME = "ai-agents.shared";
const METER_NAME = "ai-agents.shared";

/**
 * Wrap an async operation in a custom span. Nests under the currently active
 * span (e.g. the tool call that invoked it) via normal context propagation.
 */
export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: () => Promise<T>,
): Promise<T> {
  return trace.getTracer(TRACER_NAME).startActiveSpan(
    name,
    { attributes },
    async (span) => {
      try {
        const result = await fn();
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.recordException(
          error instanceof Error ? error : new Error(String(error)),
        );
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

/**
 * Attach a structured log event to the currently active span. No-op when no
 * span is active or no provider is registered.
 */
export function logEvent(name: string, attributes?: Attributes): void {
  trace.getActiveSpan()?.addEvent(name, attributes);
}

/**
 * Metric counter. Valid to call immediately; a no-op until a meter provider
 * is registered (metric export wiring is a follow-up — see the openspec
 * change's out-of-scope list).
 */
export function counter(name: string): Counter {
  return metrics.getMeter(METER_NAME).createCounter(name);
}

/** Metric histogram. Same no-op contract as {@link counter}. */
export function histogram(name: string): Histogram {
  return metrics.getMeter(METER_NAME).createHistogram(name);
}
