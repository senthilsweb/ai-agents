import { createAgentInstrumentation } from "shared/lib/instrumentation.js";

export default createAgentInstrumentation({
  attributes: (input) => ({
    "privacy_classifier.pii_engine": process.env.PII_ENGINE ?? "unset",
    "privacy_classifier.step_index": String(input.step.index),
  }),
});
