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
    "A plain-text document is classified unstructured and fully processed " +
    "(the columnar-rejection case is covered separately).",
  async test(t) {
    const turn = await t.send(
      `Classify this document for PII/NPI and compliance impact. File path: ${fixture}`,
    );
    turn.expectOk();
    t.completed();
    t.calledTool("classify_document_structure");
    t.calledTool("assemble_report");

    const runId = extractRunId(turn.toolCalls);
    const result = readRunJson(runId, "result.json") as {
      document: { structural_class: string; processing_status: string };
    };
    t.check(result.document.structural_class, equals("unstructured"));
    t.check(result.document.processing_status, equals("processed"));
  },
});
