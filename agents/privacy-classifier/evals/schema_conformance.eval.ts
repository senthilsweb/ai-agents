import { defineEval } from "eve/evals";
import { matches } from "eve/evals/expect";

import { DocumentClassificationSchema } from "#lib/schemas.js";

import { extractRunId, readRunJson } from "./lib/run_result.js";

// Staged under agent/sandbox/workspace/inputs/ (auto-mounted into the
// sandbox at /workspace/inputs/), mirroring evals/data/unstructured_prose.txt.
// load_input only accepts sandbox-staged filenames, never a host path — see
// agents/privacy-classifier/agent/tools/load_input.ts.
const fixture = "unstructured_prose.txt";

export default defineEval({
  description:
    "The final result.json always validates against the generic " +
    "DocumentClassification schema.",
  async test(t) {
    const turn = await t.send(
      `Classify this document for PII/NPI and compliance impact. File path: ${fixture}`,
    );
    turn.expectOk();
    t.completed();

    const runId = extractRunId(turn.toolCalls);
    const result = readRunJson(runId, "result.json");
    t.check(result, matches(DocumentClassificationSchema));
  },
});
