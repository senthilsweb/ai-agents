# Proposal: wiki-live-pages

**Status:** APPROVED 2026-07-14 (owner: "Fantastic Idea. Agreed…" with
refinements: public dashboard is --jd none AND target-free with a
URL-based way to filter his roles; console aimed at public datasets;
chained workflows; plus a CI/CD wiki page with a left-to-right mermaid
diagram)

## Why

The wiki is text-only while two live surfaces exist right next to it:
the DuckDB browser console (`utils/`) and the daily trends dashboard
(currently local/private only). Publishing both on the existing Pages
site makes the public dataset explorable in one click and the trends
readable daily with zero install — without growing the git repo,
because both pages are produced in CI. Separately: the FAQ page name,
the standard page set, and missing markdown capabilities (mermaid,
sortable tables, footnotes) need one consistency pass across repos,
and the deployment chain deserves its own wiki page.

## What changes

1. **Live pages on the site** — the docs workflow, after `mkdocs
   build`, copies the console to `site/console/` and builds the trends
   dashboard from the committed parquet into `site/trends/` with
   `--jd none` (copyright boundary D3) and `--no-targets`. A second
   cron (11:45 UTC, after the 11:00 data publish) refreshes the site
   daily — needed because bot pushes made with GITHUB_TOKEN cannot
   trigger other workflows.
2. **Target filtering moves to the URL** — new `--no-targets` build
   flag embeds no role keywords; the page instead reads
   `?roles=a,b,c` from its URL and renders the same tracker for those
   keywords. The owner bookmarks his roles; the public page carries
   none.
3. **Markdown capabilities in both repos** — mermaid (superfences),
   footnotes, collapsible details, tabbed blocks, and sortable tables
   (tablesort via extra_javascript, Material's documented approach).
4. **FAQ named FAQ** — nav + page title in both wikis; style guide
   updated: FAQ always named exactly that; Runbook required for every
   project; Configuration required whenever a product has config/.env;
   projects with more than one workflow add a CI/CD page.
5. **CI/CD wiki page** — how deployment works: one left-to-right
   mermaid diagram of the workflow chain plus a short write-up.

## Out of scope

- Publishing any JD text or the owner's keyword list in the public
  dashboard build.
- Serving MinIO/private-S3 from the hosted console (mixed-content;
  local serving stays documented in utils/README.md).
- agent-job-matcher gets FAQ rename + plugin parity only (tracked as
  Bolt 3 of its own project-wiki change).

## Acceptance criteria

1. `…/ai-agents/console/` serves the DuckDB browser; its default query
   returns rows against the public parquet.
2. `…/ai-agents/trends/` serves a dashboard with zero JD text and zero
   embedded role keywords; `?roles=ai engineer,engineering manager`
   renders the tracker for exactly those keywords.
3. The dashboard refreshes daily without any new git commits (site
   built in CI only).
4. Mermaid renders on the ai-agents site; tables sort on click;
   footnotes work — same in agent-job-matcher.
5. Both wikis' nav shows "FAQ"; the style guide records the new page
   rules; docs/ci-cd.md exists with the LR diagram.
