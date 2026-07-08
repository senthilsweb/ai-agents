import { defineEval } from "eve/evals";

// Staged under agent/sandbox/workspace/inputs/ (auto-mounted into the
// sandbox at /workspace/inputs/), mirroring evals/data/structured_data.csv.
// load_input only accepts sandbox-staged filenames, never a host path — see
// agents/privacy-classifier/agent/tools/load_input.ts.
const fixture = "structured_data.csv";

export default defineEval({
  description:
    "A columnar file (CSV) is rejected by the deterministic gate before any " +
    "extraction, chunking, or detection tool runs.",
  async test(t) {
    const turn = await t.send(
      `Classify this document for PII/NPI and compliance impact. File path: ${fixture}`,
    );
    turn.expectOk();
    t.completed();
    t.calledTool("classify_document_structure");
    t.notCalledTool("extract_document_text");
    t.notCalledTool("chunk_text");
    t.notCalledTool("detect_privacy_entities");
  },
});
