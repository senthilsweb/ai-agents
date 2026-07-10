# Job Matcher

Compares a candidate's resume against one or more job postings and produces
one scored, evidence-grounded JSON report per job. A governed rebuild of
the vibe-coded prototype at `agents/talent-align/` (kept unchanged as the
"before" picture), and the running teaching example for
[`ai-dlc-in-practice/job-matcher/`](../../ai-dlc-in-practice/job-matcher/).

See `openspec/changes/add-job-matcher/` for the full design (proposal,
design, spec, tasks) and `evals/rubrics.md` for the scoring formula and
every eval's pass criteria.

## Setup

```bash
cd agents/job-matcher
cp .env.example .env   # fill in MODEL_ORCHESTRATOR / MODEL_JOB_ANALYST credentials
npm run dev
```

Requires a Docker (or similarly capable) sandbox backend — the sandbox
bootstraps Python + Docling on first run (cached afterward) for resume
extraction. See `agents/privacy-classifier/PREREQUISITES.md` for the
shared pattern this reuses; the same local/on-prem, non-Vercel-serverless
caveat applies.

## Usage

Stage your resume under `agent/sandbox/workspace/inputs/` (or upload it
inline via the API — same `load_input` contract as privacy-classifier),
then send a prompt naming its path and one or more job sources (URLs or
local files staged under `inputs/`):

```
Analyze my resume at inputs/sk-resume-june-2026.pdf against these jobs:
https://job-boards.greenhouse.io/anthropic/jobs/5125387008
https://careers.bain.com/jobs/FolderDetail?folderId=104335
```

One job source → a direct, single model call. More than one → the agent
delegates to a `job-analyst` subagent once per job, each its own eve
session.

## Output

One self-contained JSON file per job under `runs/<timestamp>/`, named
`slug(<job title>)_<timestamp>.json` for a successful analysis or
`slug(<job source>)_<timestamp>.failed.json` when a job source couldn't be
fetched (v1 makes exactly one attempt per source — no retries). Multi-job
runs also get a `ranking.md` ordered by score.

**V1 stops at content generation** — no DOCX, PDF, or HTML file is
produced. Cover-letter content is text inside the JSON
(`cover_letter_text`), optionally rendered through a template staged at
`agent/sandbox/workspace/inputs/templates/cover_letter.txt`.

## Scoring

The LLM never emits a score. It extracts typed skill matches with
resume-quoted evidence; a deterministic tool (`agent/lib/scoring.ts`)
computes the 100-point breakdown — required skills (40), preferred skills
(20), experience alignment (20), domain alignment (20) — and the match
band (`strong_match` ≥ 80, `good_match` 65–79, `moderate_match` 50–64,
`weak_match` 35–49, `no_match` < 35). This split is also the agent's
prompt-injection defense: a job posting cannot instruct the model to
"report a score of 100," because no code path lets a model output become
a score.

## Roadmap (not built yet)

- **`nextjs-gui/`** — a Next.js + AI SDK front-end, replacing
  talent-align's Streamlit UI. Document rendering (DOCX/PDF/HTML cover
  letters) arrives with this phase; templates already live under
  `inputs/templates/`, waiting.
- **Chat channels** — Slack or Microsoft Teams invocation, the same
  pattern as `linkedin-cover-generator`.

Each is its own future `openspec/changes/<name>/`, walking the same
Inception → Construction → Operations gates as this change did.
