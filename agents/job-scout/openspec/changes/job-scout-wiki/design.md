# Design: job-scout-wiki

## D1 — Markdown in-repo, not the GitHub Wiki tab
Pages live in `agents/job-scout/docs/` so they are versioned with the
code they describe, reviewable in PRs, and render on GitHub with zero
infrastructure. The GitHub Wiki tab is a separate repo that drifts and
cannot be reviewed — rejected. Root `docs/` stays for monorepo-wide
topics (architecture, telemetry cookbooks).

## D2 — Organized by task, not by module
Page map (each page starts with "what you'll have at the end"):
index (Home), getting-started, installation, configuration,
data-and-queries, dashboards-and-reports, runbook, faq.
Content is largely relocation: README deep sections, data/README.md
pointers, openspec design summaries. Specs/ADRs are linked, never
rewritten — the wiki explains *how to use*, specs record *why built*.

## D3 — Link strategy (must work in two renderers)
Pages render on GitHub (paths relative to the file) and on the MkDocs
site (docs_dir-relative). Rules: links between wiki pages are plain
relative (`configuration.md`); links to anything outside docs/ (code,
config.yaml, data/README.md, workflows) use absolute GitHub URLs so
they work from the published site too.

## D4 — README trim
README keeps: intro, the "I want to → run this" matrix (now pointing
at wiki pages), a Documentation section listing the eight pages, and
Layout. Sections that moved (adding companies, raw landing table,
trends/public data detail, refresh modes, population flow, run/
quickstart, sponsors, match pipeline, resume, logging) are replaced by
one-line pointers. No content is lost — every removed paragraph has a
new home in a page.

## D5 — MkDocs Material on GitHub Pages
Root `mkdocs.yml` with `docs_dir: agents/job-scout/docs` — the site is
job-scout-only for now; when a second agent gets docs, switch to the
mkdocs-monorepo plugin (one `!include` per agent) without touching
page content. Theme: Material, light/dark palettes, code-copy buttons,
navigation from an explicit `nav:` (eight pages + the api-match
reference). Workflow `.github/workflows/job-scout-docs.yml`: on push
to main touching docs/mkdocs.yml + dispatch; build with
`pip install mkdocs-material`, `mkdocs build --strict` (broken links
fail the build), deploy via actions/upload-pages-artifact +
actions/deploy-pages (no gh-pages branch). One-time: repo Pages source
must be "GitHub Actions" (attempt via `gh api`, else manual).

## D6 — Plain-English authoring standard
Owner's standing rule (remote-India audience): simple words, short
sentences, no idioms, define terms where first used ("a *slug* is the
short name in the job-board URL"). Commands shown exactly as typed,
with the expected output where it helps. Safety facts repeated where
the reader acts on them: paid-match guard, personal files never
committed, JD text never public.
