import { createBaseSandbox } from "shared/sandbox/base-sandbox.js";

// ── Python toolchain bootstrap (Docling only, CLI-exec) ─────────────────────
//
// See openspec/changes/add-job-matcher/design.md.
//
// Resume extraction (PDF/DOCX/TXT, with OCR fallback for scanned PDFs)
// reuses privacy-classifier's Docling-in-sandbox pattern: a Python toolchain
// installed once at sandbox-build time (cached via revalidationKey) and run
// as a one-shot CLI script from agent/tools/extract_resume_text.ts (Bolt 2).
// Unlike privacy-classifier, job-matcher needs no Presidio (no PII
// detection) and no Chonkie (no semantic chunking) — a resume is short
// enough to pass whole.
//
// IMPORTANT — local/on-prem only, same caveat as privacy-classifier: this
// bootstrap runs `apt-get install` at build time and requires a Docker (or
// similarly capable) sandbox backend. Not expected to work on Vercel's
// serverless Functions deployment path.

const VENV = "/opt/job-matcher-venv";

/** Path to the venv's Python interpreter — shared by any tool that execs a script. */
export const PYTHON_BIN = `${VENV}/bin/python3`;

export default createBaseSandbox({
  revalidationKey: "job-matcher-bootstrap-v1",
  extraBootstrap: async (sandbox) => {
    await sandbox.run({
      command: [
        "apt-get update -y",
        "apt-get install -y --no-install-recommends python3 python3-venv python3-pip tesseract-ocr",
        `python3 -m venv ${VENV}`,
        `${VENV}/bin/pip install --quiet --upgrade pip`,
        `${VENV}/bin/pip install --quiet docling`,
      ].join(" && "),
    });
  },
});
