# Proposal: docs-monorepo-job-pilot — two-agent docs site

> Status: **APPROVED** (2026-07-15, owner-requested). Owner: @senthilsweb.

## Why

The GitHub Pages site (senthilsweb.github.io/ai-agents) serves only
job-scout's wiki. job-pilot shipped today and needs its docs on the
same site. The root `mkdocs.yml` recorded the plan for exactly this
moment: switch to the mkdocs-monorepo plugin when a second agent gets a
`docs/` folder.

## What changes

1. **Root `mkdocs.yml`** becomes the umbrella site (`site_name:
   ai-agents`): monorepo plugin with one `!include` per agent, a new
   root landing page (`docs/index.md`) listing the agents and the live
   pages, and mkdocs-redirects mapping every old top-level job-scout
   URL (e.g. `/getting-started/`) to its new home under `/job-scout/`
   so published links keep working.
2. **`agents/job-scout/mkdocs.yml`** (new, child): site_name
   `job-scout`, the existing nav, pages unchanged.
3. **`agents/job-pilot/docs/`** (new) + **`agents/job-pilot/mkdocs.yml`**
   (child): the style-guide standard set — index, Getting Started,
   Configuration, Runbook, CI/CD, FAQ.
4. **`.github/workflows/job-scout-docs.yml`**: install the two plugins,
   watch job-pilot's docs paths too. Live pages (/console/, /trends/)
   are copied into `site/` after the mkdocs build exactly as before —
   untouched.

## Impact

- URLs: job-scout wiki pages move from `/<page>/` to
  `/job-scout/<page>/` with redirects covering every old URL;
  `/console/` and `/trends/` do not move. job-pilot appears at
  `/job-pilot/`.
- Publishing still happens on push to main (nothing publishes until
  the pending job-pilot work is committed and pushed).
