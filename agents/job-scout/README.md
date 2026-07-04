# job-scout

Part of the [senthilsweb/ai-agents](https://github.com/senthilsweb/ai-agents) monorepo
(`agents/job-scout`). Unlike the eve-based siblings, this one is a fully
self-contained Python stack: marimo + DuckDB + YAML config, deterministic-first
with an optional Anthropic agentic layer.

Spec-driven (OpenSpec), deterministic-first job search pipeline in a marimo
notebook backed by DuckDB. Optional agentic search via Anthropic API.

## Discovery — three tiers (per openspec/specs/search-pipeline)
- **Tier 1 — deterministic ATS APIs (no LLM, no scraping).** The "Fetch
  postings via ATS APIs" button (`tools/ats_fetch.py:fetch_all`) **seeds a
  company row for every slug in `config.yaml`
  `search.ats_org_slugs_by_company`, then fetches** postings from the public
  Greenhouse / Lever / Ashby / Workday JSON endpoints, filters titles against
  `targets.title_keywords` (forgiving token match), dedups on company+req_id,
  and persists comp bands. `search.verify_before_insert` gates a live
  open/closed check. This populates `job_posting` from config alone.
- **Tier 2 — search plan.** Config-driven query list for manual/agentic execution.
- **Tier 3 — agentic fallback** for JS-only career sites (empty templates).

## How the database gets populated (concrete flow)
Two independent pipelines write into `job_tracker.duckdb`. They only meet at
one point (step 9) — running one does **not** automatically trigger the other.

1. Notebook creates the schema idempotently. Every table starts at 0 rows.
2. Tier 1 reads `config.yaml`'s `search.ats_org_slugs_by_company` (e.g.
   Snowflake, Monte Carlo, NVIDIA).
3. Tier 1 seeds those company names into `company` with their `ats_platform`
   (Ashby/Workday/etc.), `pipeline_status='not_started'`.
4. Tier 1 fetches live postings from each company's real ATS JSON API,
   filters titles (forgiving token match), and inserts → `job_posting` +
   `compensation` rows.
5. Separately, `fetch_sponsors_rainfocus.py` calls the RainFocus API directly
   for a conference (e.g. DAIS 2026) and paginates through the full exhibitor
   catalog.
6. It rule-classifies each exhibitor (keyword/tier heuristics, no LLM),
   excluding non-hiring-relevant booths (e.g. "Customer Activations").
7. `load_sponsors.py` inserts one `conference` row.
8. `load_sponsors.py` inserts a new `company` row for every sponsor name
   **not already present** — name + classification only, no `ats_platform`,
   no job postings yet.
9. If a sponsor name **matches** a company already seeded by Tier 1 (step 3),
   the loader **enriches** that row's empty fields instead of duplicating it
   — existing values are never overwritten.
10. `load_sponsors.py` inserts one `sponsorship` link row per sponsor, joining
    company ↔ conference with tier.
11. End state: `company` and `sponsorship` grow from the sponsor load, but
    `job_posting` stays exactly as it was after step 4 — sponsor loading
    never fetches postings.
12. **The gap**: sponsor-only companies exist and are `pipeline_status='not_started'`,
    but nothing has an ATS slug for them, so Tier 1 can't fetch their postings.
13. **To close the gap**: either add a sponsor's ATS slug to `config.yaml`
    (Tier 1), or run the Tier 2 search-plan generator — which already
    includes every `not_started` company — and execute those queries
    manually or via Tier 3 agentic mode.

## Run
    pip install marimo duckdb pyyaml pandas python-dotenv anthropic certifi
    marimo edit notebook.py

Tune everything in `config.yaml`. For agentic mode: copy `.env.example` to
`.env`, add `ANTHROPIC_API_KEY`, set `agentic.enabled: true`.

### Quickstart — empty DB to a shortlisted, ranked board
1. Launch the notebook (`marimo edit notebook.py`). The schema is created
   idempotently; every table starts empty.
2. Scroll to the **"Fetch postings via ATS APIs (Tier 1)"** button and click
   it — seeds companies from `config.yaml` and pulls real postings (see
   "How the database gets populated" above). No data needs to be pre-loaded.
3. *(Optional)* Load conference sponsors too — see "Conference sponsors" below.
4. Scroll back up to the **"Ranked board"** cell and re-run it (click the
   cell, then ▶ / Cmd+Enter — or use marimo's "Run all cells").
   > **Gotcha:** marimo re-runs a cell only when a variable it depends on is
   > *reassigned* upstream. The Tier 1 button mutates the DuckDB connection's
   > data in place — it never reassigns the `con` variable — so the Ranked
   > board **will not auto-refresh** after a fetch. Always manually re-run it
   > (or "Run all cells") after any fetch/load step, including the sponsor loader.
5. Adjust the scoring sliders (domain fit / compensation / HLS bonus /
   location penalty / visa gate) above the board — this part *is* reactive
   and recomputes instantly, no re-fetch needed.
6. The board is your shortlist: ranked by `match_score`, open postings
   first. CSV/Parquet copies (all + per-company) are written to `exports/`
   each time the exports cell runs.

## Conference sponsors
Populate `company`/`conference`/`sponsorship` from a RainFocus-hosted
conference catalog (e.g. Databricks DAIS — the full paginated exhibitor
catalog, not just the first page). Profile id/cookie are read from `.env`
(`RAINFOCUS_PROFILE_ID` / `RAINFOCUS_COOKIE`) or CLI args — never committed:

    python tools/fetch_sponsors_rainfocus.py --load   # fetch → classify → load

The loader (`tools/load_sponsors.py`) is idempotent and accepts any CSV path
(no `seeds/` folder). Re-runs create zero duplicate companies or sponsorships.
When a sponsor matches a company already seeded by Tier 1, its empty
`classification`/`industry`/`company_stage`/`notes` fields are **back-filled**
from the sponsor row without overwriting existing values. See
[ADR 0001](openspec/adr/0001-deterministic-first-three-tier-discovery.md) for
the discovery architecture.

### Getting a RainFocus profile id
`rfapiprofileid` is a per-event identifier RainFocus-hosted conference sites
send as a request header — it is not published anywhere in the page HTML, so
pull it from your browser's network traffic:

1. Open the conference's exhibitor/sponsor directory page (e.g. the
   Databricks Data + AI Summit site) in Chrome/Firefox.
2. Open DevTools → **Network** tab, filter to **Fetch/XHR**.
3. Reload the page and find the request to
   `events.rainfocus.com/api/exhibitors` (or similarly named endpoint).
4. Open that request's **Request Headers** and copy the `rfapiprofileid` value.
5. If the directory is session-gated (uncommon for a public sponsor list),
   also copy the `Cookie` header value.
6. Paste both into your **local `.env`** as `RAINFOCUS_PROFILE_ID` /
   `RAINFOCUS_COOKIE` — never into `.env.example` or any committed file. The
   id is specific to that event's microsite build and typically rotates
   between events/years, so re-extract it per conference.

## Resume context
Convert your resume once, deterministically (no LLM):

    python tools/resume_to_md.py inputs/resume.pdf

The .md output is auto-appended to the agent system prompt as <candidate_resume>.

## Logging
Every run writes a timestamped file to logs/run_YYYYMMDD_HHMMSS.log
(plan counts, skips, exports, agentic calls). Directory and level in config.yaml.

## Layout
    config.yaml            all tunable parameters (search, thresholds, weights)
    .env.example           secrets template (API key only)
    notebook.py            marimo app: schema → sliders → ranked view → exports → search plan → agentic
    openspec/              project.md + specs (data-model, scoring, search-pipeline)
    exports/               generated CSV/Parquet
