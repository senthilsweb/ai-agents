# Design: wiki-live-pages

## D1 — Live pages are CI artifacts, never commits
`site/` is already gitignored; the docs workflow simply adds content
to it between `mkdocs build` and `upload-pages-artifact`:
- `cp utils/duckdb-s3-console.html site/console/index.html`
- copy the committed `data/ats_raw_trends.parquet` to a dated temp
  name (so the page stamp shows today) and run
  `build_trends_report.py --jd none --no-targets` →
  `site/trends/index.html` (~2 MB, lives only on the Pages CDN).
The repo never grows; a bad build fails CI before deploy.

## D2 — Refresh chain: two crons, not workflow triggers
Data publishes at 11:00 UTC (trends workflow). The docs workflow gains
`schedule: 45 11 * * *`. A push-based chain is impossible by design:
commits made with the default GITHUB_TOKEN do not trigger `on: push`
workflows (GitHub's recursion guard); a PAT would work but adds a
credential for no real gain. 45 minutes of slack covers the data job's
normal duration. Worst case (data job late): the dashboard serves
yesterday's facts until the next cron — acceptable for a trends page.

## D3 — Public dashboard: facts only, roles via URL
Two build-time guarantees for the published copy:
- `--jd none` (existing): zero JD text (copyright boundary,
  trends-dashboard D3).
- `--no-targets` (new): `keywords_json` embeds `[]`. Client JS then
  reads `?roles=a,b,c` from the URL: present → the target tracker
  renders for those keywords via the same client-side token matcher;
  absent → the tracker card is hidden entirely. The owner's keyword
  list thus never ships in the page; he bookmarks
  `…/trends/?roles=…` privately. (The list is technically already in
  the public config.yaml, but the page should not advertise it.)

## D4 — Markdown capability set (both repos, identical)
`footnotes`, `pymdownx.details`, `pymdownx.tabbed`,
`pymdownx.superfences` (mermaid custom fence), plus sortable tables
via Material's documented pattern: `extra_javascript` loading
tablesort from unpkg + a small `docs/javascripts/tablesort.js` that
subscribes to `document$` and initializes every unclassed article
table. CDN scripts are fine on Pages (no CSP); the artifact CSP
constraint applies only to claude.ai artifacts, not this site.

## D5 — CI/CD page
`docs/ci-cd.md` (nav after Runbook): one left-to-right mermaid
flowchart — triggers (push paths, two crons) → the three workflows →
their outputs (data commit + trends/YYYYMMDD tag, GHCR image, Pages
site with wiki/console/trends) — followed by a short write-up per
workflow and the two deliberate decouplings (data≠image, D7;
push-vs-cron chaining, D2 here). Mentions the same pattern mirrored in
agent-job-matcher.

## D6 — Naming and standard pages (style guide deltas)
FAQ pages are titled exactly "FAQ". Standard set becomes: Runbook
required for every project; Configuration required whenever any
config/.env exists; FAQ always; a CI/CD page when a project has more
than one workflow.
