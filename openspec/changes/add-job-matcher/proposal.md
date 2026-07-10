# Proposal: Add `job-matcher`

## Why

Two reasons, one agent:

1. **Real utility.** A working job-fit prototype already exists at
   `agents/talent-align/` (pydantic-ai + Streamlit/CLI, Python): resume +
   job-posting URL → typed job-fit report with deterministic scoring and a
   cover-letter angle. It works, but it lives outside every convention this
   repo has — no eve runtime, no openspec change, no run artifacts, no
   telemetry, no evals, hard-coded candidate info, and an LLM that is asked
   to *compute* the score instead of a tool that computes it. It is,
   deliberately, the "before" picture.

2. **Teaching vehicle for AI-DLC.** The existing `ai-dlc-in-practice/` deck
   is grounded in privacy-classifier — accurate but niche. Job-fit matching
   is a problem every audience member has personally lived (everyone has
   either looked for a job or hired for one), which makes it the ideal
   running example for explaining AI-DLC ceremonies, roles, and artifacts to
   a broad audience. Rebuilding talent-align *through* the process — with
   the ceremonies documented and a slide deck developed in parallel, phase
   by phase — turns the methodology into a story: "here is the vibe-coded
   prototype; here is the same capability taken through Inception,
   Construction, and Operations."

## What changes

- Add an Eve agent at `agents/job-matcher/` (TypeScript, npm workspace),
  headless — no GUI, same run process as every other agent in this repo.
- **Inputs:** a resume file plus one or more job-posting URLs (or local
  job-description text files staged under `inputs/`). The resume is either
  staged under `agent/sandbox/workspace/inputs/` and referenced by relative
  path in the prompt, or uploaded inline — reusing privacy-classifier's
  `load_input` pattern (path confinement + inline base64) as-is.
- **Fan-out policy:** exactly one job link → the orchestrator analyzes it
  directly (single-agent path, like privacy-classifier). More than one job
  link → spawn one `job-analyst` subagent per link, bounded concurrency,
  **each job link producing its own separate trace**, all correlated by
  the run id. The orchestrator additionally writes a lightweight ranked
  summary across jobs.
- **Deterministic scoring in code, not in the LLM.** The LLM's only
  generative job is structured extraction: matched/missing skills with
  evidence quotes, experience alignment, domain alignment. A deterministic
  tool computes the 100-point score breakdown and match band from those
  counts using talent-align's formula (40/20/20/20). No LLM arithmetic.
- **Evals are the headline.** Evals are written from the spec *before or
  alongside* the code (executable acceptance criteria), covering: schema
  conformance, scoring-formula correctness, evidence grounding (every
  matched skill's evidence must appear in the resume text — the
  no-hallucination guarantee), fan-out behavior (N links → N subagent
  analyses, one trace **per job link**), match-band boundaries, and
  prompt-injection resistance (a job posting containing adversarial
  instructions must not steer the agent).
- **V1 stops at content generation.** The deliverable is one full JSON
  report per job link, written to `runs/<ts>/` and named
  `slug(<job title>)_<timestamp>.json` for at-a-glance identification —
  no DOCX, PDF, or HTML rendering in this version. Cover-letter *content*
  (text) lives inside the JSON; document rendering is deferred with the
  GUI phase. Any templates (cover letter, etc.) are staged under the
  workspace `inputs/` folder, never compiled into source. Runs sync to
  host and object store via the existing shared tools.
- Models resolved from env per convention: `MODEL_ORCHESTRATOR` /
  `MODEL_JOB_ANALYST` → `MODEL_*` → startup error. No hard-coded defaults.
- **Documentation developed in parallel** (part of this change):
  - `ai-dlc-in-practice/job-matcher/ceremonies-and-roles.md` — the
    ceremonies/tasks/roles articulation of AI-DLC using job-matcher as the
    running example.
  - `ai-dlc-in-practice/job-matcher/index.html` — a companion slide deck
    (same visual identity as the existing deck), updated at each phase gate
    so every slide is grounded in a real artifact that exists by then.
- **Reserved, later phase (not built now):** `agents/job-matcher/nextjs-gui/`
  — a Next.js + AI SDK UI replacing talent-align's Streamlit front-end.
  Folder documented as roadmap only in this change.
- `agents/talent-align/` stays untouched as the reference "before" artifact.

## Impact

- Adds one new npm workspace package (`agents/job-matcher`).
- Reuses shared/privacy-classifier building blocks: `load_input` (resume
  staging/upload), `create_run` / run-artifact helpers, `sync_run_to_host`,
  `upload_run_to_object_store`, the OTel dual-export pipeline. Resume text
  extraction reuses the in-sandbox Docling extraction pattern (PDF/DOCX/TXT
  with OCR fallback) rather than reimplementing parsers.
- Adds new teaching material under `ai-dlc-in-practice/job-matcher/`; the
  existing privacy-classifier-grounded deck is not modified.
- No changes to any existing agent.

## Open questions for the inception gate

1. ~~Cover letter scope~~ — **Resolved (repo owner, 2026-07-09):** v1 stops
   at content generation. Cover-letter content (angle + paragraphs) is text
   inside the per-job JSON; no DOCX/PDF/HTML rendering in v1. Templates are
   staged under the workspace `inputs/` folder.
2. ~~Candidate info~~ — **Resolved (repo owner, 2026-07-09, inception gate
   approval):** confirmed. v1 derives candidate identity from the resume
   itself and takes no separate `CANDIDATE_INFO`-style config.
3. ~~Deck placement~~ — **Resolved (repo owner, 2026-07-09):** separate deck
   at `ai-dlc-in-practice/job-matcher/index.html`; the existing
   privacy-classifier deck moved into its own sibling folder
   `ai-dlc-in-practice/pii-classifier/index.html`.
4. ~~Trace granularity~~ — **Resolved (repo owner, 2026-07-09):** original
   intent said single trace per run; corrected at gate review to **one
   separate trace per job link**, correlated by run id.
