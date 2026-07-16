# job-pilot — AI-DLC ceremonies and roles

The running record of how `agents/job-pilot/` moves through Inception →
Construction → Operations. Updated at every gate, same discipline as
[job-matcher](../job-matcher/ceremonies-and-roles.md). Process contract:
`AI-SDLC-TAILORING.md`; change artifacts:
`openspec/changes/add-job-pilot/`.

## Roles

- **Repo owner / product owner**: @senthilsweb — sets intent, answers
  gate questions, approves each phase.
- **AI pair**: Claude Code — drafts artifacts, builds under the gates,
  logs corrections where they happen.

## 1. Inception (Mob Elaboration) — 2026-07-15

**Intent (owner's words, condensed):** combine job-scout (daily jobs
parquet) and job-matcher (match + cover letter) into a third agent:
query the latest jobs with my role filters, run the matcher, generate
cover-letter PDFs, and email me one summary a day — new jobs, match
details (title, client, location, salary), letters attached. Trigger it
from GitHub Actions. Use case: **Job Opportunity Qualification and
Outreach.** Follow AI-DLC, OpenSpec, and mob ceremonies; LangGraph is a
must (not LangChain) so human-in-the-loop can be added later; use
OpenObserve, Arize, and LangSmith for observability; since the agent has
no LLM reasoning, evals are simple code-level tests; failures must be
logged; all secrets from env and GitHub secrets.

**Elaboration findings that shaped the design:**

- Most of the pipeline already exists as job-scout tools
  (`daily_match.py`: fetch → sweep → render); the new agent is a thin
  connector, not a rebuild.
- Owner correction during elaboration: **no physical DuckDB** — the
  daily public parquet (tagged `trends/YYYYMMDD`, `main` = latest) is
  the database, queried with in-memory DuckDB over HTTPS. Verified live
  the same day: an anti-join of `main` vs `trends/20260714` over HTTPS
  found 123 new jobs; also found `classification` is empty and
  `category` is the populated column.
- Stateless "new since when": baseline tag = last successful workflow
  run date (GitHub API), no ledger.
- Public-repo privacy line inherited from the trends change: facts only;
  JD text, match results, letters, resume never in git, artifacts, or
  logs.
- Broader outreach loop phased: persona messages v1.5; contact finding
  and follow-ups v2 (the human-in-the-loop features LangGraph is being
  reserved for).

**Gate approved 2026-07-15** (same day). Owner's five answers, recorded
in the tasks.md Sign-off: name stays **job-pilot**; PDFs from
**good_match (≥65)** up; **Gmail SMTP** (not Resend); resume stays **in
the public repo, direct access** (owner overrode the drafted
private-source design; scrub of phone/street address recommended);
categories **Eng & Tech + Product + Sales & GTM** — the extra category
was a data finding at the gate: Solutions Architect and Forward
Deployed Engineer roles are filed under Sales & GTM in the snapshot.

## 2. Construction — 2026-07-15 (same day as the gate)

All five bolts plus the docs finale, in order, each closed with green
tests before the next started (34 pytest evals total — code-level only,
as planned: the agent has no LLM reasoning to judge).

- **Bolt 1** scaffold + delta + filters — the delta anti-join and the
  role filter, tested against fixture parquets written by DuckDB itself.
- **Bolt 2** match runner — JD harvest ported from job-scout's
  `match_sweep.py` with a host allowlist and size caps added; guards
  proven to abort before any paid call; one-attempt-no-retry proven by
  call counting.
- **Bolt 3** PDFs + email — **Correction 1**: WeasyPrint replaced by
  fpdf2 (pure Python) after WeasyPrint failed to import without system
  pango/gobject — the same right-sizing lesson as job-matcher's
  Docling→unpdf correction. A quiet day still sends a short email.
- **Bolt 4** graph + telemetry — LangGraph `StateGraph` with one
  conditional edge; LangSmith native + OTel dual export that degrades
  to a warning. Live e2e dry run: 123 real new jobs → 5 real candidates
  (OpenAI, Cursor, Snowflake, Coder, Harvey) → 3 PDFs → digest.html.
- **Bolt 5** Docker + CI — slim image (no apt deps thanks to
  Correction 1), built and smoke-tested locally; two workflows (digest
  after the trends publish; tests + image push). No artifact uploads
  anywhere — the email is the only output channel.
- **Security-baseline pass**: 7 items reviewed, no unresolved gaps; one
  owner action item — commit the PII-scrubbed `inputs/resume.md`.

`status: implemented`. Verification (live) remains: first guarded CI
run with real secrets, email received, traces visible in LangSmith and
OpenObserve.

## Change 2: templated-cover-letter — 2026-07-15

Owner-requested the same day: cover-letter PDFs must follow the
personal letterhead (sk-cover-letter-cmi-june-2026.pdf). Owner offered
python-docx templates; rejected because headless DOCX→PDF needs
LibreOffice/Word (the WeasyPrint lesson again) — instead the template
is data (`templates/letterhead.yaml`) rendered by the existing fpdf2
path. The analyze response's letter already carries a plain contact
line, date, Re: line and salutation; the leading contact line is
stripped (the styled header replaces it) and the signature block is
completed. Phone number stays out of the committed template (public
repo) — `LETTERHEAD_PHONE` env/secret fills it. Score metadata removed
from the PDF: a letter must be forwardable as-is. Verified by rendering
the real Snowflake analyze result and comparing against the CMI letter
side by side. `agents/job-pilot/openspec/changes/templated-cover-letter/`,
status: implemented; 42 evals green.

## Change 3: docs-monorepo-job-pilot — 2026-07-15

Owner asked for job-pilot's docs on the GitHub Pages site as a new
agent. The root `mkdocs.yml` had already prescribed the mechanism
("switch to the mkdocs-monorepo plugin when a second agent gets a
docs/ folder"), so the gate was the owner's request itself. Site
restructured to an umbrella (`/job-scout/`, `/job-pilot/` namespaces)
with redirects preserving every previously published job-scout URL;
job-pilot got the style-guide standard six pages (Home, Getting
Started, Configuration, Runbook, CI/CD, FAQ). Verified with a local
`mkdocs build --strict` plus a redirect spot-check. Publishes on the
next push to main. `openspec/changes/docs-monorepo-job-pilot/`.

The same session also filled the last Verification prerequisite:
`inputs/resume.md` created from the owner's June 2026 PDF
(deterministic pymupdf4llm conversion), phone number scrubbed, and the
PDF's two-column "Earlier Experience" block — which extraction had
garbled — restructured into readable bullets.

## Change 4: us-location-filter — 2026-07-15

Owner explored the location column in the console, saw non-US postings
would reach the paid /analyze call, and asked for a US gate ("we will
waste LLM cost"). Layered string heuristic (US markers → state codes →
state names → hub cities → known non-US → remote-ish), validated on
live data before merging: 123 new jobs → candidates went 5 → 3, and
both drops were verified correct against the parquet (Sydney, United
Kingdom). Ambiguous "Remote" stays eligible; dropped jobs stay visible
in the digest table. Recorded as a stopgap: the durable fix is a
normalized `country` column at fetch time in job-scout, at which point
this heuristic collapses to a column check.
`agents/job-pilot/openspec/changes/us-location-filter/`.

## 3. Operations — not started
