import { defineEval } from "eve/evals";
import { equals } from "eve/evals/expect";

import { extractRunId, readRunJson } from "./lib/run_result.js";

// Staged under agent/sandbox/workspace/inputs/ (auto-mounted into the
// sandbox at /workspace/inputs/), mirroring evals/data/unstructured_prose.txt.
// load_input only accepts sandbox-staged filenames, never a host path — see
// agents/privacy-classifier/agent/tools/load_input.ts.
const fixture = "unstructured_prose.txt";

export default defineEval({
  description:
    "Detection recovers the planted email and SSN-shaped entities in a prose " +
    "fixture, regardless of which PII_ENGINE is configured for this run.",
  async test(t) {
    const turn = await t.send(
      `Classify this document for PII/NPI and compliance impact. File path: ${fixture}`,
    );
    turn.expectOk();
    t.completed();

    const runId = extractRunId(turn.toolCalls);
    const result = readRunJson(runId, "result.json") as {
      findings: Array<{ canonical_type: string }>;
    };
    const canonicalTypes = new Set(result.findings.map((f) => f.canonical_type));

    t.check(canonicalTypes.has("EMAIL_ADDRESS"), equals(true));
    t.check(canonicalTypes.has("GOVERNMENT_ID_SSN"), equals(true));
  },
});
