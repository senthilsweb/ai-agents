# Proposal: Add `privacy-classifier`

## Why
Privacy engineering work (PII/NPI discovery, compliance-impact triage) is currently one-off and tied to a single downstream system. The repository needs a generic, standalone building block that classifies a document's PII/NPI content and the compliance regimes it implicates, independent of any consumer, with a model-agnostic and swappable detection backend so it can run entirely locally, entirely on frontier GenAI, or anywhere in between.

## What changes
- Add an Eve agent at `agents/privacy-classifier/`.
- Accept a local file path or an uploaded file: PDF (including scanned/image pages), DOCX, TXT, Markdown, HTML, and standalone images.
- Deterministically gate out columnar/structured files (CSV, TSV, Parquet, XLSX, DB dumps) — out of scope, rejected with a clear status, never parsed.
- Extract text locally (no hosted parsing API): Docling (Python, MIT), run as a CLI script inside the agent's own Eve sandbox, handling PDF (with automatic OCR fallback via the `tesseract-ocr` system binary), DOCX, HTML, and images through one converter; plain TXT/Markdown pass through directly.
- Chunk large documents using real embedding-based semantic chunking — [Chonkie's `SemanticChunker`](https://docs.chonkie.ai/oss/chunkers/semantic-chunker) (Python, MIT), also run as a CLI script inside the agent's own sandbox. No LLM call; boundaries come from embedding similarity, not a generative model.
- Detect PII/NPI through exactly one of four swappable engines, selected by a single required config variable: `presidio` (local, statistical/NER, no GenAI), `presidio_genai` (Presidio + GenAI merged), `openai_privacy_filter` (**reserved, not yet implemented** — a local, non-generative Python package, exact package pending from the repo owner), `genai_only` (a full/cloud frontier model).
- Return findings in a new, generic response schema — no reference to any specific downstream consumer.
- Normalize raw entity labels (from any LLM's phrasing or Presidio's native vocabulary) to one canonical taxonomy, config-driven via YAML.
- Union/dedupe findings across chunks and across engines.
- Deterministically map normalized findings to impacted compliance regimes using a maintained, extensible matrix seeded with GDPR, CCPA/CPRA, India's DPDP Act, Argentina's PDPL, HIPAA, LGPD, and PIPEDA.
- Produce one final JSON result per run.
- Explicitly exclude, for this version: columnar/structured file processing, fingerprinting, document "profiling," file checksums, and any subagent/multi-hop reasoning step (roadmap only).
- Add evals (`agents/privacy-classifier/evals/`) — the first adopter of Eve's native eval harness in this monorepo.
- Document every external dependency and an explicit deployment constraint in `PREREQUISITES.md`: this agent's local-tooling approach (Python/pip/apt installed into the sandbox at build time) is **local/on-prem only** and is not expected to work on Vercel's serverless deployment path; a Vercel-compatible deployment would need each local Python dependency replaced with a hosted service exposing a REST API instead (not implemented here — flagged as a roadmap item).

## Impact
- Adds one new npm workspace package (`agents/privacy-classifier`).
- Adds new **generic, reusable** tools/libs to `shared/` that did not exist before: the columnar-file gate, a canonical PII/NPI taxonomy + alias normalizer, and a compliance-impact matrix — verified by search, none of this exists in `shared/` today.
- Adds a Python toolchain to the agent's own Eve sandbox (bootstrap-time, cached): `docling`, `presidio-analyzer` + a spaCy model, `chonkie[semantic]` + its default embedding model, and the `tesseract-ocr` system package. All are invoked as CLI scripts via `sandbox.run()` — no separate service, no docker-compose file, no WASM library. See `PREREQUISITES.md`.
- No changes to any existing agent.
