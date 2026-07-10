# Job Matcher Agent Specification

## Requirement: Input sources
The agent SHALL accept one resume file (PDF, DOCX, TXT, or Markdown) and one or more job sources per run. The resume SHALL be provided either as a relative path under `agent/sandbox/workspace/inputs/` stated in the prompt, or as an inline upload — via the same `load_input` contract as privacy-classifier, including its path-confinement guards. Job sources SHALL be public URLs and/or local job-description text files under `inputs/`.

## Requirement: Fan-out policy and per-job traces
When exactly one job source is supplied, the orchestrator SHALL analyze it directly with one strongly-typed structured-output call and SHALL NOT spawn a subagent. When more than one job source is supplied, the agent SHALL spawn one `job-analyst` subagent per successfully fetched job source — each delegation its own eve child session, and therefore its own trace. Fetch concurrency SHALL be code-bounded (configurable); subagent dispatch concurrency SHALL be instruction-paced at the same limit. A run's traces SHALL be correlatable across its jobs via eve's automatic session-tree tags (`$eve.parent`/`$eve.root`) and the run id carried in each delegation message. *(Amended 2026-07-10, Construction: originally "every trace SHALL carry the run id as an attribute" — eve's span-attribute hook is read-only over its callback input and cannot carry a tool-minted run id; see design.md Telemetry Correction.)*

## Requirement: Deterministic scoring
Match scores SHALL be computed by a deterministic tool from the typed analysis (matched/total skill counts, experience alignment, domain alignment) using the fixed rubric: required skills 0–40, preferred skills 0–20, experience 0–20, domain 0–20, total 0–100, with match bands strong ≥ 80, good 65–79, moderate 50–64, weak 35–49, no-match < 35. The LLM SHALL NOT produce any numeric score.

## Requirement: Evidence grounding
Every skill reported as matched SHALL carry an evidence quote drawn from the extracted resume text. The agent SHALL NOT invent candidate experience; unmatched skills SHALL carry no evidence. Evidence grounding SHALL be enforced by an eval.

## Requirement: Untrusted job content
Job-posting text SHALL be treated as data, not instructions: it SHALL be delivered to analysis calls in a fenced, labeled frame, and instructions embedded in a job posting SHALL NOT alter agent behavior. Resistance SHALL be verified by an adversarial-fixture eval.

## Requirement: Job fetch guards
URL fetching SHALL enforce an http/https scheme allowlist, a response size cap, and a minimum-extractable-text guard. A page that cannot be fetched or extracted (network error, non-2xx status, JavaScript-rendered shell, login wall, below the minimum-words guard) SHALL yield a clear per-job failure status with a reason — never a fabricated analysis.

## Requirement: Graceful link failure — log, stop, no retry
The agent SHALL make **exactly one fetch attempt per job source**. On failure it SHALL log the failure, record the per-job failure status, and **stop processing that job source** — no retries, no analysis call, no subagent spawn, and no score for that job. Other job sources in the same run SHALL continue unaffected; a mixed run completes with analysis JSONs for the successful sources and failure records for the failed ones. A run in which every source fails SHALL end gracefully with failure records, not an error crash.

## Requirement: Per-job JSON output, content generation only
A run SHALL produce exactly one JSON report **per job source**: `slug(<job title>)_<timestamp>.json` for an analyzed job (run metadata, resume file reference, the typed analysis, the computed score breakdown, the match band, a deterministic recommendation, and rendered cover-letter text), or `slug(<job source>)_<timestamp>.failed.json` for a job that could not be fetched. The extracted resume text and each job's text SHALL be persisted in the same run folder (`resume.txt`, `jobs/<n>.txt`) and referenced, not embedded, by the reports. *(Amended 2026-07-10, Construction: originally required embedding the job and resume texts in every report — dropped as pure duplication across a multi-job run's files; see design.md Correction.)* V1 SHALL NOT generate DOCX, PDF, or HTML documents. Multi-source runs SHALL additionally write a lightweight ranked summary ordered by total score.

## Requirement: Templates staged under inputs
Any template (cover letter or otherwise) and any prompt override SHALL be staged under the workspace `inputs/` folder and loaded at runtime — never compiled into agent source. A missing template SHALL degrade to plain text fields, not fail the run.

## Requirement: Model-agnostic configuration
Each model-backed role (orchestrator, job analyst) SHALL resolve its model via `MODEL_<ROLE>_* → MODEL_* → startup error`, with no hard-coded model id or default. The same analyst model resolution SHALL apply to both the direct (single-job) and subagent (multi-job) paths.

## Requirement: No embedded candidate configuration
The agent SHALL derive candidate identity from the resume content. No candidate name, contact detail, or biography SHALL be hard-coded in source or configuration.

## Requirement: Telemetry
GenAI call metrics SHALL ride the AI SDK's native telemetry over the shared OpenTelemetry dual-export pipeline, with no bespoke instrumentation.

## Requirement: Run artifacts
Each run SHALL persist its inputs' extracted text, per-job analyses, per-job JSON reports, and a run summary (`summary.json`: per-session token usage and estimated cost, mandatory for every agent run per ADR 0001 §5) under a timestamped `runs/` folder, synced to the host and uploaded via the existing shared tools.

## Requirement: Evals
The agent SHALL ship evals covering: per-job report schema conformance (including the `slug(<job title>)_<timestamp>.json` naming contract), scoring-formula determinism, match-band boundaries, evidence grounding, multi-job fan-out with one-session-per-job verification (N job sources → N `job-analyst` delegations with N distinct child session ids — the assertable proxy for N traces), single-job direct path (no subagent), prompt-injection resistance, and graceful link-failure handling (single attempt, logged, per-job stop, no retry, remaining jobs unaffected). Deterministic evals (scoring, banding) SHALL run without a live model.

## Requirement: Real-world eval dataset
Evals SHALL run against a committed real-world corpus under `evals/data/`: the repo owner's resume (`resume/sk-resume-june-2026.pdf`) and six real LinkedIn-sourced job links captured on 2026-07-09 — four with extractable JD snapshots (Anthropic, Bain, Gusto, Temporal) and two genuine JavaScript-shell failures (ADP workforcenow, Ashby/Jerry.ai) serving as fetch-guard fixtures — plus a synthetic adversarial JD. Captured snapshots, not live URLs, SHALL be the eval inputs (reproducible after postings close); `jobs/manifest.json` SHALL record each link's URL, provenance, and fetch status at capture time. Live URLs remain available for smoke runs.

## Requirement: Eval rubrics
Every eval SHALL have a written rubric in `evals/rubrics.md`, authored at Inception, distinguishing **HARD** criteria (objective, deterministic; any violation blocks `implemented → verified`) from **SOFT** criteria (directional expectations about extraction quality against the real corpus; misses are logged and reviewed at the verification ceremony). The canonical scoring formula, including empty-denominator handling, SHALL be stated in the rubric and SHALL be the single source of truth the scoring tool and its evals both implement.

## Requirement: Headless operation
The agent SHALL run entirely through the standard eve dev/run flow with no GUI. A `nextjs-gui/` front-end is a documented later phase, out of scope for this change.
