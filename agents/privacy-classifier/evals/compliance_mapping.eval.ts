import { defineEval } from "eve/evals";
import { equals } from "eve/evals/expect";

import { mapToJurisdictions } from "shared/lib/compliance.js";

// Pure unit check — no t.send, no model call, no sandbox. The compliance
// matrix is a deterministic lookup (openspec/changes/add-privacy-classifier
// requirement: "never an LLM inference"), so it's tested as one directly.
export default defineEval({
  description:
    "The compliance matrix deterministically maps known canonical types to " +
    "their expected jurisdictions.",
  async test(t) {
    const health = mapToJurisdictions(["HEALTH_RECORD_ID"]);
    t.check(health.impacted_jurisdictions.includes("HIPAA"), equals(true));
    t.check(health.impacted_jurisdictions.includes("CCPA_CPRA"), equals(false));

    const ssn = mapToJurisdictions(["GOVERNMENT_ID_SSN"]);
    t.check(ssn.impacted_jurisdictions.includes("CCPA_CPRA"), equals(true));
    t.check(ssn.impacted_jurisdictions.includes("PIPEDA"), equals(true));
    t.check(
      ssn.hits.every((hit) => hit.severity === "high"),
      equals(true),
    );

    const unknown = mapToJurisdictions(["UNKNOWN"]);
    t.check(unknown.impacted_jurisdictions, equals([]));
  },
});
