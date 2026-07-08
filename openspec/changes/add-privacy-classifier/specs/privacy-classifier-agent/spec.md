# Privacy Classifier Agent Specification

## Requirement: Input sources
The agent SHALL accept a local file path or an uploaded file as input, including PDFs with embedded images or fully scanned pages, DOCX, TXT, Markdown, HTML, and standalone images.

## Requirement: Document-shape gating
The agent SHALL deterministically classify the input as `structured_columnar`, `semi_structured`, or `unstructured` before extraction. Columnar/structured files (CSV, TSV, Parquet, XLSX, database dumps) SHALL be rejected with `processing_status: "skipped_out_of_scope"` and SHALL NOT be parsed, chunked, or sent to any detection engine.

## Requirement: Local-only extraction with OCR fallback
Text extraction SHALL run entirely locally — no hosted parsing API and no network call. PDFs, DOCX, HTML, and standalone images SHALL be extracted via Docling running inside the agent's own sandbox, with automatic local OCR fallback for scanned/image content. Plain TXT/Markdown SHALL be passed through directly without invoking an extractor.

## Requirement: Semantic chunking
When extracted content exceeds a configurable size, the agent SHALL split it into semantically coherent chunks using real embedding-based semantic chunking (Chonkie's `SemanticChunker`), not a fixed-size or purely syntactic (paragraph/sentence) heuristic. Chunk size and the similarity threshold SHALL be configurable via a local YAML file, not hardcoded. No LLM call is involved in chunking.

## Requirement: Swappable detection engine
The agent SHALL support exactly one active detection engine per run, selected via a required `PII_ENGINE` environment variable with no default: `presidio` (local, statistical/NER-based, no GenAI call), `presidio_genai` (Presidio and GenAI both run, findings merged), `openai_privacy_filter` (a local, non-generative Python package — **reserved, not yet implemented**; selecting it SHALL fail fast with a clear error rather than silently producing incomplete results), or `genai_only` (a full/cloud frontier model). An unset or invalid value SHALL fail at startup, not silently default.

## Requirement: Parallel, strongly-typed GenAI detection
For any engine that includes a GenAI path, detection SHALL run in parallel across chunks (bounded concurrency, configurable) using structured output (a strongly-typed schema, not free-text JSON parsing). The system prompt driving detection SHALL be overridable per invocation and via configuration, without a code change.

## Requirement: Generic response schema
The per-chunk and final response schemas SHALL be generic to privacy engineering and SHALL NOT reference any specific downstream consuming system.

## Requirement: Cross-chunk and cross-engine normalization
Raw entity labels — whether free-text LLM phrasing or Presidio's native entity-type vocabulary — SHALL be normalized to one canonical taxonomy via a configurable YAML alias table. Findings SHALL be unioned and deduplicated across both chunks and, when `presidio_genai` is active, across engines.

## Requirement: Deterministic compliance-impact mapping
Mapping normalized findings to impacted compliance regimes SHALL be a deterministic, tool-based lookup against a maintained, extensible matrix — never an LLM inference. The matrix SHALL be seeded with GDPR, CCPA/CPRA, India's DPDP Act, Argentina's PDPL, HIPAA, LGPD, and PIPEDA, and SHALL be extensible to additional jurisdictions without a code change.

## Requirement: Single final result
A run SHALL produce exactly one JSON result object combining document metadata, normalized findings, and compliance impact.

## Requirement: Model-agnostic configuration
Every model-backed role (orchestrator, PII detector) SHALL resolve its model from environment variables with no hard-coded model id or default, per the existing `MODEL_<ROLE>_* -> MODEL_*` convention. Any model or provider SHALL be swappable via `.env` alone.

## Requirement: Telemetry without custom instrumentation
Token, context-size, cache, and latency metrics for GenAI calls SHALL be captured via the AI SDK's native per-call telemetry riding the existing shared OpenTelemetry pipeline — no bespoke token/cost measurement tool. Latency for the local Presidio HTTP call SHALL be captured via the shared custom telemetry signals, since it carries no LLM tokens for the AI SDK to instrument.

## Requirement: Result transfer and storage
At the end of a run, artifacts SHALL be copied from the sandbox to the host via the existing shared `sync_run_to_host` tool, then uploaded to an S3-compatible object store via the existing shared `upload_run_to_object_store` tool (a no-op when object storage is not configured). Neither tool SHALL be reimplemented.

## Requirement: Evals
The agent SHALL ship evals covering: columnar-file rejection, document-shape classification accuracy, OCR-fallback triggering, PII/NPI detection recall/precision against a fixture corpus, compliance-mapping correctness, final-result schema conformance, label-alias normalization, and correct engine dispatch for each implemented detection engine (`openai_privacy_filter` excluded until implemented).

## Requirement: Documented prerequisites and deployment constraint
Every external, non-npm dependency (Python, Docling, Presidio + its spaCy model, Chonkie + its embedding model, `tesseract-ocr`, and the reserved `openai_privacy_filter` package) SHALL be listed in `PREREQUISITES.md` with its purpose and license. The documentation SHALL explicitly state that this agent's local-tooling approach is local/on-prem only and is not expected to work on Vercel's serverless deployment path, and SHALL note that a Vercel-compatible variant would require replacing each local dependency with a service exposing a REST API instead.
