# Tasks: job-scout-wiki

## Bolt 1 — Scaffold + first three pages
- [x] 1.1 docs/index.md (Home: what it is, three surfaces, audience pointers, page map)
- [x] 1.2 docs/getting-started.md (three 5-minute paths: dashboard, public data, local notebook)
- [x] 1.3 docs/installation.md (Docker image / compose / local Python; .env)
- [x] 1.4 docs/configuration.md (config.yaml reference + env var table + add-a-company how-to)

## Bolt 2 — Deep pages + README front door
- [x] 2.1 docs/data-and-queries.md (tables, raw landing workflow, public dataset, cookbook, sponsors, console)
- [x] 2.2 docs/dashboards-and-reports.md (trends dashboard, match report, sharing rules)
- [x] 2.3 docs/runbook.md (workflows, checks, failures + fixes, paid-match procedure)
- [x] 2.4 docs/faq.md (design decisions with links to specs/ADRs)
- [x] 2.5 README trimmed to front door; matrix links point at wiki pages

## Bolt 3 — Published site
- [x] 3.1 mkdocs.yml (Material theme, nav, docs_dir=agents/job-scout/docs); site/ gitignored
- [x] 3.2 .github/workflows/job-scout-docs.yml (build --strict, pinned mkdocs<2, deploy-pages)
- [x] 3.3 Pages enabled via API (build_type=workflow); local strict build passes, anchors verified in built HTML
