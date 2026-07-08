# Privacy Classifier

An Eve agent that classifies a document's PII/NPI content and the compliance regimes it implicates, independent of any downstream system. See `openspec/changes/add-privacy-classifier/` for the full design and **`PREREQUISITES.md` for external dependencies and a deployment-compatibility warning — read that before deploying anywhere other than local dev.**

## What it does

1. Accepts a file staged under `agent/sandbox/workspace/inputs/` (referenced by filename) or an uploaded file: PDF (including scanned/image pages), DOCX, TXT, Markdown, HTML, or a standalone image.
2. Deterministically rejects columnar/structured files (CSV, TSV, Parquet, XLSX, DB dumps) — out of scope.
3. Extracts text locally via Docling (Python, run inside the agent's own sandbox), with automatic OCR fallback for scanned/image content.
4. Splits large documents into semantically coherent chunks via [Chonkie's SemanticChunker](https://docs.chonkie.ai/oss/chunkers/semantic-chunker) (embedding-similarity boundaries, Python, in-sandbox — no LLM).
5. Detects PII/NPI via exactly one swappable engine (`PII_ENGINE`): `presidio`, `presidio_genai`, `openai_privacy_filter` (reserved, not yet implemented), or `genai_only`.
6. Normalizes every raw label (any model's phrasing, or Presidio's own vocabulary) to one canonical taxonomy.
7. Deterministically maps normalized findings to impacted compliance regimes (GDPR, CCPA/CPRA, India's DPDP Act, Argentina's PDPL, HIPAA, LGPD, PIPEDA — extensible).
8. Produces one JSON result (`result.json`) plus the standard `summary.json` (tokens/cost/budget).

## Run

```bash
cd agents/privacy-classifier
cp .env.example .env   # fill in PII_ENGINE, MODEL_ORCHESTRATOR[_*], and MODEL_PII_DETECTOR[_*] if using a GenAI engine
npm run dev
```

First run takes noticeably longer than usual — the sandbox bootstraps Python, Docling, Presidio, Chonkie, and their ML models (see `PREREQUISITES.md`). This is cached afterward.

## Detection engines

| `PII_ENGINE` | Presidio | GenAI | Notes |
|---|---|---|---|
| `presidio` | yes | no | Fully local, no LLM call, no token cost. |
| `presidio_genai` | yes | yes | Both run; findings merged before normalization. |
| `openai_privacy_filter` | no | no | **Reserved, not yet implemented.** A local, non-generative Python package (not an LLM) — exact package/API pending. Selecting it fails fast at `create_run` with a clear TODO message; see `agent/lib/engine.ts`. |
| `genai_only` | no | yes | `MODEL_PII_DETECTOR` points at a cloud/gateway model. |

## Prerequisites and deployment

See **`PREREQUISITES.md`** for the full external-dependency list (Python, Docling, Presidio, Chonkie, Tesseract, and their ML models) and an explicit warning: this agent's local-tooling approach is **local/on-prem only** and is not expected to work on Vercel's serverless deployment path. A Vercel-compatible deployment would need each local Python dependency replaced with a hosted service exposing a REST API instead — noted there as a roadmap item, not implemented here.

## Out of scope for this version

Columnar/structured file processing, fingerprinting, document profiling, file checksums, and any subagent/multi-hop reasoning step. See `openspec/changes/add-privacy-classifier/design.md` for the full non-goals list.
