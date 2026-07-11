import { createBaseSandbox } from "shared/sandbox/base-sandbox.js";

// ── Plain base sandbox (no Python toolchain) ────────────────────────────────
//
// Correction (2026-07-10, Construction): the original design reused
// privacy-classifier's Docling-in-sandbox extraction, which bootstraps a
// ~5.4GB Python venv (apt-get + pip install docling) at template-build time.
// That is proportionate for privacy-classifier's broad any-document scope,
// but overkill for one short resume — and its apt-get bootstrap blocked
// Vercel deployment. Resume extraction now runs in pure Node inside
// agent/tools/extract_resume_text.ts (unpdf for PDF, mammoth for DOCX), so
// this agent only needs the shared base sandbox (image pin + .DS_Store
// purge), the same minimal setup as linkedin-cover-generator — and is
// deployable on Vercel, where the backend auto-switches to Vercel Sandbox.

export default createBaseSandbox({
  revalidationKey: "job-matcher-bootstrap-v2",
});
