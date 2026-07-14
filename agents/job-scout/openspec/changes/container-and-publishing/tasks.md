# Tasks: container-and-publishing

## Bolt 1 — Container runtime + GHCR image
- [x] 1.1 JOB_SCOUT_CONFIG env override in match_sweep.load_config and build_trends_report
- [x] 1.2 Dockerfile + .dockerignore + docker/entrypoint.sh (named jobs; match guarded by RUN_PAID_MATCH)
- [x] 1.3 agents/job-scout/docker-compose.yml (profiles: trends, match, shell; env_file .env optional)
- [x] 1.4 .github/workflows/job-scout-image.yml (GHCR push, amd64+arm64, latest/sha/date tags)
- [x] 1.5 README: Docker section (image, compose, standalone config mount, one-time GHCR public flip)
- [x] 1.6 Matcher endpoints env-overridable (JOBMATCH_API_BASE / JOBMATCH_AGENT_BASE in load_config; .env.example documented)

## Bolt 2 — Help slide-over in dashboard
- [x] 2.1 Template: help icon (lucide SVG) + #help slide-over with concise grouped bullets
- [x] 2.2 Template: remove inline details.method + trim footer note; ESC/shade close either panel
- [x] 2.3 Rebuild dashboard; republish artifact (same URL)

## Bolt 3 — Tag-based parquet publishing
- [x] 3.1 data/: single canonical ats_raw_trends.parquet (git rm dated + latest)
- [x] 3.2 Workflow: copy to canonical name, drop prune, push lightweight tag trends/YYYYMMDD
- [x] 3.3 README + dashboard footer: new URL contract (main = current, tag ref = point in time)
- [x] 3.4 Verify: DuckDB reads the canonical raw URL and the trends/20260714 tag ref (both return 5,421 rows)

## Bolt 4 — Audience-first docs
- [x] 4.1 Compose: explicit environment list on every service (pass-through from shell/.env), not env_file
- [x] 4.2 Help slide-over rewritten in plain English: three audience sections + column guide
- [x] 4.3 data/README.md: data dictionary + example DuckDB query gallery (all 6 queries tested)
- [x] 4.4 README: "I want to → run this" quickstart matrix up top
- [x] 4.5 Rebuild dashboard; republish artifact (same URL)
