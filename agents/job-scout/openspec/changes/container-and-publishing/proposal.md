# Proposal: container-and-publishing

**Status:** APPROVED 2026-07-14 (owner requested in session)

## Why

Three friction points remain after trends-dashboard shipped:

1. Running the pipeline needs a laptop with the right Python packages.
   The owner wants a ready-to-use public Docker image (GHCR) so the
   tools and pipeline jobs run anywhere — server, CI, fresh machine —
   with docker compose profiles for the common jobs.
2. The dashboard's method/normalization notes sit inline at the bottom
   of the page. They belong behind a help icon that opens a slide-over
   panel: short bullets, organized by topic, out of the reading flow.
3. The public parquet is published twice per day (dated file + a
   `_latest` copy) with a prune loop. The owner prefers timestamp/tag
   based publishing over a `latest` suffix, plus general simplification.

## What changes

1. **Container runtime** — `agents/job-scout/Dockerfile` (python-slim +
   the five runtime deps + tools/templates/config), an entrypoint with
   named jobs (`load`, `export`, `report`, `trends`, `match`), a
   `docker-compose.yml` with optional profiles (`trends`, `match`,
   `shell`), and a GitHub Action that builds and pushes
   `ghcr.io/senthilsweb/job-scout` (amd64+arm64) on every push touching
   the agent. `.env` is passed through compose `env_file` (same vars as
   `.env.example`: ANTHROPIC_API_KEY, RAINFOCUS_*). The paid `match` job
   additionally requires `RUN_PAID_MATCH=yes` — structural guard against
   accidental LLM spend.
2. **Help slide-over** — a question-mark icon (inline SVG, lucide
   `help-circle`) in the dashboard header opens a right slide-over with
   the method notes as concise grouped bullets; the inline
   `<details>` block and long footer note are removed.
3. **Tag-based publishing** — one canonical `data/ats_raw_trends.parquet`
   overwritten daily on `main` (stable URL, no suffix); each publish
   creates a lightweight git tag `trends/YYYYMMDD`, so any date is
   fetchable via the tag ref. Dated duplicate files and the 90-day prune
   loop are removed.

## Out of scope

- Changing what the pipeline does (fetch/promote/match logic untouched).
- Publishing JD text anywhere public (D3 boundary from trends-dashboard
  stands).
- Switching the daily trends workflow to run inside the image (kept
  pip-based so data freshness never depends on image build health).
- marimo notebook in the image (interactive, local-only).

## Acceptance criteria

1. `docker build` succeeds from `agents/job-scout/`; `docker run
   ghcr.io/senthilsweb/job-scout trends` produces a trends parquet and
   dashboard HTML inside the container with no host checkout.
2. `docker compose --profile trends up` from the agent folder runs the
   same job against the checkout's config/DB/exports.
3. The `match` job exits with a clear error unless `RUN_PAID_MATCH=yes`.
4. The image workflow pushes `latest`, `sha-*`, and date tags to GHCR
   using only GITHUB_TOKEN (owner flips package visibility to public
   once, in GitHub UI).
5. Dashboard shows a help icon; clicking opens the slide-over with the
   method bullets; the inline method block is gone; artifact keeps its
   URL on republish.
6. `SELECT count(*) FROM '<raw url>/main/agents/job-scout/data/ats_raw_trends.parquet'`
   works from stock DuckDB; the same path under a `trends/YYYYMMDD` tag
   ref returns that day's snapshot; no `_latest` or dated files remain
   in `data/`.
