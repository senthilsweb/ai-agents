# Design: add-enterprise-ats-boards

## ATS investigation record (2026-08-07)

All findings verified live with curl; endpoints listed so the check is
reproducible.

| Company | Careers front-end | Actual ATS | Slug | Evidence |
|---|---|---|---|---|
| HPE | Phenom (`careers.hpe.com`, site id HPE1US) | Workday wd5 | `hpe/Jobsathpe` | Phenom `/widgets` payload's `applyUrl` → `hpe.wd5.myworkdayjobs.com/Jobsathpe/...`; CXS `POST .../wday/cxs/hpe/Jobsathpe/jobs` → total 1073 |
| AVEVA | Links straight to Workday | Workday **wd3** | `aveva/AVEVA_careers/wd3` | `aveva.wd3.myworkdayjobs.com/AVEVA_careers` on careers page; CXS → total 246 |
| Cohesity | AEM page, server-side proxy `/bin/cohesity/open-positions` | Workday wd5 | `cohesity/Cohesity_Careers` | Proxy JSON `jobUrl` → `cohesity.wd5.myworkdayjobs.com/Cohesity_Careers/...`; CXS → total 209. Greenhouse board `cohesity` 404s (`gh_jid` in page JS is legacy) |
| Quinnox | WordPress/Elementor, server-rendered | **none** | — | `/career/<slug>/` static pages; WP REST exposes no job CPT; `quinnox.keka.com` → TenantNotFound; `quinnox.zohorecruit.com/jobs/Careers` → "Page does not exist"; Greenhouse/Lever slugs 404 |

## Decisions

- **D1 — HPE via Workday CXS, not Phenom.** The Phenom `/widgets` API
  works (POST, `refineSearch`, 1075 hits) and would be a new fetcher +
  new req-id semantics. Not needed: the underlying Workday board is
  publicly queryable and returns the same numeric req ids
  (e.g. 1192313) that appear in HPE's apply URLs. Zero new code wins.
- **D2 — Workday host rides in the slug: `tenant/site/host`.**
  `fetch_all` and `raw_load._fetch_one` both call
  `fetch_workday(*slug.split("/"))`, whose third positional parameter is
  `host` (default `wd5`). A three-segment slug therefore already works
  end-to-end, including JD harvest (`_workday_description` re-derives
  tenant/host/site from the apply URL). This change documents that form
  (config comment, `_infer_platform` docstring, docs/configuration.md,
  search-pipeline spec) instead of inventing a dict form for Workday —
  consistent with ADR 0001's "platform inferred from slug shape".
- **D3 — Quinnox stays out of Tier 1.** ADR 0001: "HTML scraping of
  career pages — rejected as the default... reserved for the Tier 3
  agentic path." A one-off Elementor scraper would be brittle, and the
  board's ~30 delivery-engineering roles (Calypso, SAP, .NET) don't
  intersect the owner's title keywords, so the cost buys nothing.
  Recorded in the config's "Not loadable" comment with the date, same as
  Shopify/Boomi/Retool.
- **D4 — No pagination change.** HPE's 1,073 postings vs the 20-per-page
  CXS cap mirrors NVIDIA (2,000). Delta mode accumulates new reqs daily;
  a pagination loop is future work if coverage proves insufficient.
  **Correction (D4-r, 2026-08-07):** reversed same-day on owner
  follow-up — first-page-only made the new boards mostly invisible
  (HPE's first page is 20 of 1,073, sorted newest-first and dominated by
  India postings). `fetch_workday` now takes `max_postings`
  (None = first page, 0 = whole board, N = cap) driven by
  `search.workday_max_postings` in config (set to 0). Pages are deduped
  on `externalPath` because boards can repeat rows across page
  boundaries. Cost accepted: a full daily raw load is ~180 extra listing
  requests plus per-posting JD fetches for the four Workday boards
  (~3.5k postings total, ThreadPool(8) in raw_load); job-pilot's next
  delta will see a one-time flood of "new" rows, absorbed by its
  category/title/salary filters and `max_jobs_per_run` guard.

- **D5 — Backfill pre-marked as analyzed via marker rows.** The 439
  backfilled postings would all have hit the paid /analyze API on the
  next sweep (match_sweep has no per-run cap). Owner chose to skip them:
  each harvestable backfill posting gets an `api_match_result` row with
  `match_status='skipped_backfill'`, the real harvested `jd_sha256`, and
  NULL scores/`report_json_path`. Sweep selection is (no row) OR (sha
  changed), so markers suppress the charge while a future JD edit still
  triggers a real analysis, which overwrites the marker via the existing
  INSERT OR REPLACE. Marker rows are excluded from the rendered report
  and from the first-analyzed (NEW badge) derivation. Markers were
  scoped to exactly the backfill set (4 Workday companies,
  first_seen = 2026-08-07): 215 older unanalyzed postings discovered on
  other boards during marking were left unmarked — that backlog predates
  this change and the owner only approved skipping the backfill.

## Security baseline

- No secrets involved; all three endpoints are public unauthenticated
  JSON already exercised by the existing NVIDIA entry.
- No JD text lands in public `data/` (facts-only parquet unchanged).
- Config values are sent verbatim to `*.myworkdayjobs.com` only; the
  three-part slug introduces no new request surface (host is
  interpolated into the same hostname pattern as the existing default).

## Non-goals

Phenom support, Quinnox scraping, Workday pagination (see proposal
"Out of scope").
