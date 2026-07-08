# Tasks

## Sign-off

- **Inception-gate approval (retroactive)**: reviewed and approved by
  @senthilsweb on 2026-07-08. This approval was granted *after* implementation
  was already complete, not before Construction started — see the "process
  gap" entry in `AI-SDLC-TAILORING.md` at the repo root for why that ordering
  happened and what changes going forward. Design (`design.md`), proposal
  (`proposal.md`), and spec (`specs/privacy-classifier-agent/spec.md`) are
  approved as written, including the "Security baseline" section added
  during this review.
- **Status**: `implemented` (see `.openspec.yaml`) — Construction is complete
  and typechecked; `verified` is the next gate, blocked on the two live-run
  tasks below (25–26), which require a real model/API key and are explicitly
  deferred, not skipped.

## Build tasks

- [x] Write proposal, design, and spec (this change).
- [x] `shared/lib/run.ts`: add `writeBinaryRunArtifact`.
- [x] `shared/lib/taxonomy.ts`, `shared/lib/compliance.ts` + `shared/config/{label_aliases,compliance_matrix}.yaml`.
- [x] `shared/tools/classify_document_structure.ts`.
- [x] Agent package scaffold: `package.json`, `tsconfig.json`, `.env.example`, `README.md`, `PREREQUISITES.md`.
- [x] `agent/sandbox/sandbox.ts` (Python 3 + `docling` + `presidio-analyzer` + spaCy model + `chonkie[semantic]` + its embedding model + `tesseract-ocr` bootstrap).
- [x] `agent/sandbox/workspace/scripts/extract_document.py` (Docling), `presidio_analyze.py` (Presidio), `chunk_text.py` (Chonkie `SemanticChunker`) — all CLI wrappers, all in-sandbox exec.
- [x] `agent/tools/extract_document_text.ts`, `agent/tools/chunk_text.ts`, `agent/tools/detect_pii_presidio.ts` (agent-local — all exec the sandbox Python scripts).
- [x] `agent/lib/schemas.ts` (chunk response, canonical taxonomy, normalized finding, compliance impact, final result).
- [x] `agent/tools/create_run.ts`, `load_input.ts`, `read_run_file.ts` + shared re-export shims (`sync_run_to_host`, `upload_run_to_object_store`, `read_usage`, `classify_document_structure`).
- [x] `agent/tools/detect_privacy_entities.ts` (engine dispatch: Presidio branch, GenAI branch, merge; `openai_privacy_filter` fails fast as TODO).
- [x] `agent/tools/normalize_findings.ts`, `map_compliance_impact.ts`, `assemble_report.ts`.
- [x] `agent/agent.ts`, `agent/instructions.md`, `agent/instrumentation.ts`, `agent/channels/eve.ts`, `agent/hooks/usage.ts`.
- [x] `agent/config/{chunking.yaml, detection_prompt.default.md}`. (No `agent/skills/*.md` — the pipeline is fully deterministic/tool-driven; `instructions.md` alone is sufficient.)
- [x] Evals: `columnar_rejection`, `doc_type_classification`, `ocr_fallback`, `pii_entity_detection`, `compliance_mapping`, `schema_conformance`, `label_alias_normalization`, `engine_selection`. Fixtures in `evals/data/`, including a generated synthetic scanned-document PNG for the OCR eval.
- [x] Root `AGENTS.md`: add the `privacy-classifier` entry.
- [x] Root `package.json`: add `dev:privacy-classifier` / `build:privacy-classifier` / `typecheck:privacy-classifier` scripts.
- [x] Repo-wide scan for "pentaho"/"pdc"/"hitachi" — found and fixed one stray reference in this agent's own code (an eval description); the only other hits are unrelated pre-existing content in other agents (an `api-test-generator` example product code, and a personal resume file in `job-scout/inputs/`), intentionally left untouched.
- [x] **Correction**: the engine originally named `genai_local_lightweight` (assumed to be a local LLM via Ollama) was renamed to `openai_privacy_filter` per repo-owner correction — it is a local, non-generative Python package, not an LLM, and does not share a code path with `genai_only`. Marked as an explicit TODO (fails fast with a clear error) pending a reference implementation from the repo owner.
- [x] **Chunking**: replaced the deterministic TS paragraph/sentence/token-budget splitter with real embedding-based semantic chunking via Chonkie's `SemanticChunker` (Python, in-sandbox exec, same pattern as Docling/Presidio). Removed the now-unused `shared/tools/chunk_text.ts` and `shared/lib/tokenizer.ts` (and the `gpt-tokenizer` dependency) since nothing else in the repo used them.
- [x] `PREREQUISITES.md`: full external-dependency list (Python, Docling, Presidio, Chonkie, Tesseract, and their ML models) with an explicit Vercel-serverless-incompatibility warning and the REST-API-alternative note for a future deployment variant.
- [x] `npm -w privacy-classifier run typecheck` passes (verified clean; also re-verified `shared` and every other existing agent still typecheck cleanly — `api-test-generator`'s two pre-existing failures are unrelated and untouched by this change).
- [x] **Security baseline review** (multi-agent identify + verify pass, see "Security baseline" in `design.md`): fixed shell command injection via unescaped subprocess args (`agent/lib/shell.ts` + 3 call sites), fixed arbitrary host-file read in `load_input` (now confined to sandbox-staged `agent/sandbox/workspace/inputs/`, evals updated to match), hardened `read_run_file` against shell-quote breakout. Re-typechecked clean after fixes.
- [ ] Manual `eve dev` smoke run against an unstructured fixture and a columnar fixture (requires a live model/API key + first-time sandbox bootstrap — not run in this session, per explicit instruction to defer testing to a later phase).
- [ ] Run `eve eval` end-to-end against a live dev server (same reason — deferred).
- [ ] Reference implementation for `openai_privacy_filter` (blocked on repo owner supplying the package/example code and documentation).
