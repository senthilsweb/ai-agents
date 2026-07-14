# Tasks: wiki-live-pages

## Bolt 1 — Target-free public dashboard build
- [x] 1.1 build_trends_report.py: --no-targets flag (embeds empty keyword list)
- [x] 1.2 template: ?roles= URL param drives the tracker; card hidden when no keywords at all
- [x] 1.3 local verify: default build unchanged; --no-targets + ?roles renders correctly

## Bolt 2 — Live pages + plugins on the site
- [x] 2.1 mkdocs.yml: footnotes, details, tabbed, mermaid superfences, tablesort extra_javascript (+ docs/javascripts/tablesort.js)
- [x] 2.2 docs workflow: 11:45 UTC cron; build site/console/ + site/trends/ (--jd none --no-targets, dated stamp) before upload
- [x] 2.3 wiki links: getting-started (live URLs as the cheapest path), data-and-queries (console URL), dashboards-and-reports (public copy + ?roles=)

## Bolt 3 — Consistency + CI/CD page
- [x] 3.1 FAQ rename (nav + H1 + referring links) in ai-agents
- [x] 3.2 style guide: FAQ naming, Runbook-for-all, Configuration-when-config-exists, CI/CD-page rule
- [x] 3.3 docs/ci-cd.md with LR mermaid diagram + write-up; added to nav
- [x] 3.4 agent-job-matcher parity (its project-wiki Bolt 3): FAQ rename + plugin set + tablesort js
- [ ] 3.5 deploy verified: /console/ works, /trends/ facts-only + ?roles= works, mermaid/tables/footnotes render
