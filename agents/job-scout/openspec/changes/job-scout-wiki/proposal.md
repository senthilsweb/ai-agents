# Proposal: job-scout-wiki

**Status:** APPROVED 2026-07-14 (owner: "Agreed. and approved.")

## Why

job-scout's documentation grew inside one long README plus scattered
spec files. It is organized by file, not by task; newcomers cannot find
the 5-minute path, operators have no runbook, and the plain-English
standard applied to the dashboard help has no equivalent for the repo
docs. The owner wants a wiki for all agents, starting with job-scout.

## What changes

1. **Wiki pages in the repo** — `agents/job-scout/docs/` gains eight
   task-organized pages (Home, Getting Started, Installation,
   Configuration, Data & Queries, Dashboards & Reports, Runbook,
   FAQ & Design Decisions), written in plain English, commands
   copy-pasteable, each page opening with what the reader will have at
   the end. Existing `docs/api-match-pipeline.md` stays as the deep
   reference and is linked, not duplicated.
2. **README becomes a front door** — intro, quickstart matrix, layout,
   and links into the wiki; deep content moves to the pages it belongs
   to (nothing is deleted, only relocated).
3. **Published site** — MkDocs Material builds the same markdown into a
   searchable site on GitHub Pages
   (https://senthilsweb.github.io/ai-agents/), deployed by a workflow on
   every docs push.

## Out of scope

- Wikis for the other agents (this change sets the pattern; each agent
  follows later with its own docs/ + a nav entry).
- The GitHub Wiki tab (separate repo, no PR review — rejected).
- Translating specs/ADRs into wiki prose (linked instead).

## Acceptance criteria

1. All eight pages exist under `agents/job-scout/docs/` and render
   correctly on GitHub.
2. README contains no section whose content now lives in a wiki page —
   it links instead — and keeps the "I want to → run this" matrix.
3. Every command in the wiki is copy-pasteable and was run (or
   dry-run) during authoring; internal links resolve on GitHub AND on
   the MkDocs site.
4. `mkdocs build` passes with no broken-link warnings; the Pages
   workflow deploys the site from main using only repo-native auth.
5. Plain-English standard: no idioms, short sentences, terms defined
   where first used.
