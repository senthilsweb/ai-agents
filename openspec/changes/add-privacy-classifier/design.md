# Design

## Architecture
```
input (path/upload)
  -> create_run
  -> load_input
  -> classify_document_structure   (gate: columnar/structured -> reject, stop)
  -> extract_document_text         (local OCR fallback for scanned/image pages)
  -> chunk_text                    (semantic, Chonkie SemanticChunker)
  -> detect_privacy_entities       (engine-routed; GenAI path parallel per chunk)
  -> normalize_findings            (canonical taxonomy, union across chunks + engines)
  -> map_compliance_impact         (deterministic matrix lookup)
  -> assemble_report               (final result.json + summary.json)
  -> sync_run_to_host
  -> upload_run_to_object_store
```

## Model routing
- Orchestrator: reasoning-class model (role `orchestrator`) — run coordination and tool sequencing only. It does not see raw document content beyond what tool results summarize.
- PII detector (`genai_only` / `presidio_genai` only): fast, non-reasoning-class model (role `pii_detector`) — glue/extraction only, per `openspec/adr/0001-shared-agent-runtime-kit.md` §4's "never put a heavy reasoning model on a glue role" rule.

## Engine routing (swappable detection backend)
`PII_ENGINE` selects exactly one of `presidio | presidio_genai | openai_privacy_filter | genai_only`. No default — unset is a startup error, consistent with `resolveModel`'s "no silent default" convention. Internally `detect_privacy_entities` only branches on two booleans:

| Engine | Presidio | GenAI |
|---|---|---|
| `presidio` | yes | no |
| `presidio_genai` | yes | yes |
| `openai_privacy_filter` | no | no — **reserved, not yet implemented** |
| `genai_only` | no | yes |

`openai_privacy_filter` is a **TODO**: a local, non-generative Python package (explicitly confirmed not an LLM despite the name) that the repo owner will supply a reference implementation/package for later. The enum value is reserved now (so the config surface and docs already show all four engines), but `resolvePiiEngine()` fails fast with a clear error if it's selected — see `agent/lib/engine.ts`. It does **not** share a code path with `genai_only` (an earlier draft of this design assumed it was a local LLM via Ollama and collapsed it into the GenAI branch; that assumption was wrong and has been corrected).

Presidio, Docling (extraction), and Chonkie (chunking) are all Python. Rather than a WASM port or a separate sidecar service, all three run as CLI scripts **inside the agent's own Eve sandbox** (already a Docker container) via `sandbox.run()`. The sandbox bootstrap installs Python 3, `docling`, `presidio-analyzer` + a spaCy model, `chonkie[semantic]` + its default embedding model, and the `tesseract-ocr` system package (cached via `revalidationKey`, so it's a one-time cost per environment, not per run). Node tools shell out with `sandbox.run({ command: "python3 /workspace/scripts/<script>.py <args>" })` and read the JSON/text the script writes back. No network hop, no separate service to keep running, no docker-compose file. **This is local/on-prem only — see `PREREQUISITES.md` for the full dependency list and why it does not work as a Vercel serverless deployment.**

## Extraction
Text extraction uses **Docling** (Python, MIT-licensed, IBM), run as a CLI script inside the agent's own sandbox — not a WASM library. Docling natively handles PDF (with automatic OCR fallback per bitmap region via its `OcrAutoOptions`/`TesseractCliOcrOptions`, backed by the `tesseract-ocr` system binary), DOCX, HTML, and images through one converter, so it replaces what would otherwise be a four-library stack (a PDF engine, an OCR engine, a DOCX parser, an HTML parser). Plain TXT/Markdown files are passed through directly (no extraction needed). This was originally scoped around WASM libraries (mupdf + tesseract.js); that was reversed after feedback that Python-in-Docker-via-exec is preferred, and it happens to also resolve mupdf's AGPL-3.0 licensing concern (Docling, Presidio, and Chonkie are all MIT).

## Chunking
Chunking uses **Chonkie's `SemanticChunker`** ([docs.chonkie.ai](https://docs.chonkie.ai/oss/chunkers/semantic-chunker), Python, MIT), also run as a CLI script inside the agent's own sandbox, following the same pattern as Docling/Presidio. Boundaries come from embedding similarity (Chonkie's default embedding model, `minishlab/potion-base-32M`, a small/fast static-embedding model — no GPU needed), not a paragraph/sentence heuristic and not a generative model call. This replaced an earlier deterministic TS-based paragraph/sentence/token-budget splitter (`shared/tools/chunk_text.ts` + `shared/lib/tokenizer.ts`), which is now removed from `shared/` since nothing uses it anymore — real semantic chunking was always the intent, and the earlier splitter was an explicit v1 simplification pending exactly this kind of library.

## Loop policy
Single deterministic pipeline, no review/regeneration loop. `detect_privacy_entities` fans out once per chunk with bounded concurrency (default 5, `PII_DETECTION_CONCURRENCY`) across whichever GenAI engine is active; the Presidio branch runs once against the full extracted text (Presidio has no meaningful context-window limit, so it does not need chunking). No retries beyond transport-error backoff. No declared subagents: the only LLM step is a uniform, stateless, single-shot structured-extraction call made directly from a tool via the AI SDK's `generateObject`, not a multi-turn reasoning role — spinning up an isolated-sandbox subagent per chunk would add sandbox/conversation overhead with no benefit and would blur the 1:1 chunk-to-telemetry-span mapping the "native AI SDK telemetry only" requirement depends on.

## Detection prompt
GenAI-engine system prompt precedence (highest first), so it is changeable without a code change: per-invocation `system_prompt` argument > `PII_SYSTEM_PROMPT` (inline env) > `PII_SYSTEM_PROMPT_FILE` (path env) > `agent/config/detection_prompt.default.md`.

## Telemetry
GenAI calls use the AI SDK's native `generateObject({ ..., telemetry: { isEnabled: true, functionId } })`, riding the existing dual OTel export pipeline (`shared/lib/instrumentation.ts`, Phoenix + OpenObserve) with zero custom instrumentation — token/latency/cache come for free on that span. This AI SDK version's `TelemetryOptions` has no `metadata` field, so each call is wrapped in a `shared/lib/telemetry.ts` `withSpan("privacy-classifier.detect_pii_genai", { runId, chunkId, engine }, ...)` custom span; the AI SDK's own span nests inside it via normal OTel context propagation, so both are visible together in the trace. Presidio's exec call carries no LLM tokens, so it uses the same `withSpan` mechanism (the documented use case for code the AI SDK doesn't see) for latency visibility. Cost is computed post-hoc from `summary.json` against the shared rate card, as with every other agent.

## Data artifacts
Each run stores `run-meta.json`, `source.<ext>`, `extracted.txt`, `chunks.json`, `pii_raw/<chunkId>.<engine>.json`, `findings.normalized.json`, `compliance_impact.json`, `result.json` (the final generic schema), and `summary.json`.

## Deployment constraint (see `PREREQUISITES.md`)
This whole design assumes a sandbox backend with real `apt`/`pip` access and a persistent, cacheable filesystem (Docker locally, or an on-prem equivalent). It is **not** expected to work on Vercel's serverless Functions deployment path. A future Vercel-compatible variant would need to replace each local Python dependency (Docling, Presidio, Chonkie, and eventually `openai_privacy_filter`) with a service exposing a REST API instead — that is a real architecture fork, tracked as a roadmap item, not implemented in this version.

## Security baseline

Added during a pre-merge security-focused review (see `AI-SDLC-TAILORING.md` at
the repo root for why this exists as a standing checklist item rather than a
one-off). Findings and fixes:

- **`detect_pii_presidio` / `detect_privacy_entities` (HIGH, confidence 9/10)
  — shell command injection via unescaped subprocess args.** `agent/lib/
  presidio.ts`, `agent/tools/extract_document_text.ts`, and `agent/tools/
  chunk_text.ts` built their `sandbox.run({ command })` string with
  `.map(arg => JSON.stringify(arg)).join(" ")`. `JSON.stringify` neutralizes
  `"`/`\` but not `$(...)`/backtick command substitution inside double
  quotes, and `sandbox.run` executes the string through a real shell
  (`bash -lc`, verified in eve's Docker session backend). The `language`
  argument on `detect_pii_presidio` was a fully free-form `z.string()` tool
  parameter reachable by the orchestrator LLM with no allow-list — a
  concrete injection sink. **Fix:** added `agent/lib/shell.ts`
  (`shellQuote`, single-quote-based — the only bash quoting style that is
  fully literal) and switched all three call sites to it; also constrained
  `language` to a 2-letter ISO 639-1 pattern as defense in depth.
- **`load_input` (HIGH, confidence 9/10) — arbitrary host file read.** The
  `path` input took a raw host filesystem path with no root confinement and
  read it via `node:fs.readFile`, while this agent's `eve.ts` channel wires
  `vercelOidc()`/`httpBasic()` (more than a single trusted local operator).
  Any authenticated caller could ask the agent to "classify" an arbitrary
  file on the host (`/etc/passwd`, another tenant's data, etc.) and get its
  content back via `result.json`. This was also the only tool in the
  monorepo reading an unconfined host path — every sibling agent (see
  `api-test-generator`'s `parse_openapi.ts`, `linkedin-cover-generator`'s
  `load_input.ts`) resolves local-file input from the sandbox's seeded
  `/workspace/inputs/` directory instead. **Fix:** `path` now names a file
  staged under `agent/sandbox/workspace/inputs/` (mounted read-only into the
  sandbox at session start per eve's workspace-seeding convention) and is
  read via `sandbox.readBinaryFile`, never `node:fs`. Eval fixtures that
  used to reference an absolute host path under `evals/data/` are now also
  staged under `agent/sandbox/workspace/inputs/` and referenced by filename.
- **`read_run_file` (hardening, not exploitable in this agent's current
  architecture) — shell metacharacter breakout.** `cat "/workspace/${path}"`
  let a `path` containing `"` break out of the quoted argument. Downgraded
  from a blocking finding on review: `path` is an orchestrator-chosen value,
  this tool isn't part of the deterministic pipeline in `instructions.md`,
  and the orchestrator is explicitly designed to never see raw document
  text (so the usual document-content-as-prompt-injection chain doesn't
  reach it here). Still fixed for defense in depth and to avoid the same
  pattern being copy-pasted into a future agent where it *would* be
  reachable: validates `path` has no `..` segment and no leading `/`, and
  reads via `sandbox.readTextFile` instead of a shell `cat`.

## Non-goals for v1
Columnar/structured file processing; fingerprinting, document profiling, file checksums; any subagent/multi-hop reasoning step; cross-chunk context carry-over during detection; content-sniffing beyond extension/magic-bytes for the columnar gate; any hosted/remote OCR or parsing API; cross-engine confidence corroboration in `presidio_genai` mode (v1 does simple union+dedupe; boosting confidence when both engines agree is a later stretch); bundling Presidio/Docling/Chonkie into anything other than the agent's own sandbox; a REST-API-based (Vercel-compatible) variant of any of the local Python dependencies.
