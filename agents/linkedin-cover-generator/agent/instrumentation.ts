// Observability for linkedin-cover-generator. The pipeline (OTel provider,
// OTLP export, OpenInference mapping for Arize Phoenix, privacy gating) lives
// in the shared Agent Runtime Kit; this file only contributes cover-specific
// span attributes. Telemetry is off unless PHOENIX_COLLECTOR_ENDPOINT or
// OTEL_EXPORTER_OTLP_ENDPOINT is set. See openspec change
// `add-agent-telemetry-and-observability`.
import { createAgentInstrumentation } from "shared/lib/instrumentation.js";

export default createAgentInstrumentation({
  attributes: () => ({
    "cover.orchestrator_model": process.env.MODEL_ORCHESTRATOR ?? "",
    "cover.image_model": process.env.IMAGE_MODEL ?? "",
  }),
});
