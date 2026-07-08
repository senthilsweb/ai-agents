import { defineEval } from "eve/evals";
import { equals } from "eve/evals/expect";

import { extractRunId, readRunJson } from "./lib/run_result.js";

// Synthetic "scanned document" fixture: a plain PNG with rendered (not
// selectable) text, so it can only be read back via real OCR, not a PDF text
// layer. Staged under agent/sandbox/workspace/inputs/ (auto-mounted into the
// sandbox at /workspace/inputs/), mirroring evals/data/scanned_onboarding.png.
// load_input only accepts sandbox-staged filenames, never a host path — see
// agents/privacy-classifier/agent/tools/load_input.ts.
const fixture = "scanned_onboarding.png";

export default defineEval({
  description:
    "A standalone image is routed through Docling's OCR path (Tesseract, " +
    "in-sandbox exec) and recovers a planted entity.",
  timeoutMs: 180_000,
  async test(t) {
    const turn = await t.send(
      `Classify this document for PII/NPI and compliance impact. File path: ${fixture}`,
    );
    turn.expectOk();
    t.completed();
    t.calledTool("extract_document_text", { output: { ocr_enabled: true } });

    const runId = extractRunId(turn.toolCalls);
    const result = readRunJson(runId, "result.json") as {
      document: { ocr_enabled: boolean };
      findings: Array<{ canonical_type: string }>;
    };
    t.check(result.document.ocr_enabled, equals(true));

    const canonicalTypes = new Set(result.findings.map((f) => f.canonical_type));
    t.check(canonicalTypes.has("EMAIL_ADDRESS"), equals(true));
  },
});
