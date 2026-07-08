# Prerequisites & Deployment Constraints

This agent depends on external, non-npm tooling. None of it is a separate long-running service you start yourself — it is all installed into the agent's own Eve sandbox (a Docker container) at **sandbox build time** and invoked as one-shot CLI scripts. This document exists so those dependencies are visible and auditable, not hidden inside a bootstrap script.

## External dependencies

| Dependency | Kind | Used by | Purpose | License |
|---|---|---|---|---|
| Python 3 + `python3-venv` | OS package (apt) | `agent/sandbox/sandbox.ts` | Runtime for all the Python tooling below | PSF |
| `tesseract-ocr` | OS package (apt) | Docling's OCR backend | OCR engine for scanned/image content | Apache-2.0 |
| `docling` | Python (pip) | `agent/tools/extract_document_text.ts` | PDF/DOCX/HTML/image text extraction, with OCR fallback | MIT |
| `presidio-analyzer` + a spaCy model (`en_core_web_sm`) | Python (pip) | `agent/tools/detect_pii_presidio.ts`, `agent/tools/detect_privacy_entities.ts` | Local, non-generative, NER/rule-based PII detection (`PII_ENGINE=presidio`/`presidio_genai`) | MIT |
| `chonkie[semantic]` + its default embedding model (`minishlab/potion-base-32M`) | Python (pip) | `agent/tools/chunk_text.ts` | Embedding-similarity semantic chunking (see [docs.chonkie.ai](https://docs.chonkie.ai/oss/chunkers/semantic-chunker)) | MIT |
| "OpenAI Privacy Filter" | Python (pip) — **TODO, not yet integrated** | `PII_ENGINE=openai_privacy_filter` | Reserved engine slot; reference implementation/package to be supplied — see `agent/lib/engine.ts` | TBD |

Every ML model above (`en_core_web_sm`, `minishlab/potion-base-32M`) is downloaded once during sandbox bootstrap (cached via the sandbox's `revalidationKey`) so a normal run never needs outbound network access for model weights.

## ⚠️ Deployment constraint: local / on-prem only

This whole approach — `apt-get install`, `pip install`, and downloading ML model weights into the sandbox image at build time — requires a sandbox backend with real package-manager and persistent-filesystem-cache access (Docker locally, or an equivalent on-prem container runtime).

**It is not expected to work on Vercel's serverless Functions deployment path.** Serverless functions don't give you a persistent, pre-bootstrapped container image with apt/pip access in the way this bootstrap assumes; even Vercel Sandbox's ephemeral microVMs are not a fit for a multi-minute apt+pip+model-download bootstrap repeated (or assumed cached) across invocations.

If a Vercel/serverless deployment of this agent is needed later, the correct fix is **not** to try to force Docker/apt/pip into that environment — it's to replace each local Python dependency with a service that exposes a **REST API** instead:

- Extraction (Docling) → a hosted document-parsing API (or a small self-hosted Docling service reached over HTTP, running elsewhere, outside the Vercel function).
- Presidio → Microsoft's official `presidio-analyzer` Docker image already exposes a REST API out of the box; point at a separately-hosted instance instead of in-sandbox exec.
- Chonkie → would need either a hosted embedding endpoint + client-side chunking logic, or a small self-hosted chunking service.
- The `openai_privacy_filter` engine (TODO) → depends entirely on what that package turns out to be; flag this the same way once it's specified.

This is a real architecture fork, not a config flag — it's noted here as a known limitation and a roadmap item, not implemented in this version.
