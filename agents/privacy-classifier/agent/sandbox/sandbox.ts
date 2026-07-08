import { createBaseSandbox } from "shared/sandbox/base-sandbox.js";

// ── Python toolchain bootstrap (Docling + Presidio + Chonkie, CLI-exec) ────
//
// See openspec/changes/add-privacy-classifier/design.md and PREREQUISITES.md.
//
// Extraction (Docling), deterministic PII/NPI detection (Presidio), and
// semantic chunking (Chonkie) are all Python. Rather than a WASM port or a
// separate long-running service, all three install once at sandbox-build
// time (cached via revalidationKey) and run as one-shot CLI scripts inside
// this same sandbox, invoked via sandbox.run() from agent/tools/
// extract_document_text.ts, agent/tools/detect_pii_presidio.ts, and
// agent/tools/chunk_text.ts.
//
// IMPORTANT — local/on-prem only: this bootstrap runs `apt-get install` and
// downloads ML models (a spaCy model, Chonkie's embedding model) at build
// time. That requires a Docker (or similarly capable) sandbox backend with
// real package-manager and filesystem-cache access. It is NOT expected to
// work on Vercel's serverless Functions deployment path. See
// PREREQUISITES.md for the full list of external dependencies and the
// deployment-compatibility note.

const VENV = "/opt/privacy-classifier-venv";

/** Path to the venv's Python interpreter — shared by every tool that execs a script. */
export const PYTHON_BIN = `${VENV}/bin/python3`;

export default createBaseSandbox({
  revalidationKey: "privacy-classifier-bootstrap-v2",
  extraBootstrap: async (sandbox) => {
    await sandbox.run({
      command: [
        "apt-get update -y",
        "apt-get install -y --no-install-recommends python3 python3-venv python3-pip tesseract-ocr",
        `python3 -m venv ${VENV}`,
        `${VENV}/bin/pip install --quiet --upgrade pip`,
        `${VENV}/bin/pip install --quiet docling presidio-analyzer "chonkie[semantic]"`,
        `${VENV}/bin/python -m spacy download en_core_web_sm`,
        // Pre-warm Chonkie's default embedding model into the image's HF
        // cache so a run never pays a model-download cost.
        `${VENV}/bin/python -c "from chonkie import SemanticChunker; SemanticChunker()"`,
      ].join(" && "),
    });
  },
});
