# Spec: job-scout wiki

## Requirement: Task-organized pages
`agents/job-scout/docs/` SHALL contain Home, Getting Started,
Installation, Configuration, Data & Queries, Dashboards & Reports,
Runbook, and FAQ pages, written in plain English with copy-pasteable
commands, each opening with what the reader will have at the end.

#### Scenario: Newcomer path
- **WHEN** a reader with Docker and no checkout follows Getting Started
- **THEN** they see the dashboard or query the public dataset within
  five minutes, without reading any other page

## Requirement: README as front door
The README SHALL keep the intro, quickstart matrix, and layout, and
SHALL link to wiki pages instead of duplicating their content.

#### Scenario: No drift
- **WHEN** a topic is documented in a wiki page
- **THEN** the README covers it only as a one-line pointer

## Requirement: Published site
A MkDocs Material site SHALL build from the same markdown with
`--strict` (broken links fail CI) and deploy to GitHub Pages on every
docs push to main.

#### Scenario: Docs push
- **WHEN** a page under docs/ changes on main
- **THEN** the site at senthilsweb.github.io/ai-agents updates without
  manual steps

## Requirement: Links resolve everywhere
Wiki-internal links SHALL be relative; links to files outside docs/
SHALL be absolute GitHub URLs, so both GitHub rendering and the
published site resolve them.

#### Scenario: Site navigation
- **WHEN** `mkdocs build --strict` runs
- **THEN** it reports zero broken internal links
