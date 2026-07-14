# job-scout

Part of the [senthilsweb/ai-agents](https://github.com/senthilsweb/ai-agents) monorepo
(`agents/job-scout`). Unlike the eve-based siblings, this one is a fully
self-contained Python stack: marimo + DuckDB + YAML config, deterministic-first
with an optional Anthropic agentic layer.

Spec-driven (OpenSpec), deterministic-first job search pipeline in a marimo
notebook backed by DuckDB. Optional agentic search via Anthropic API.

## I want to… → run this

| I want to… | Run this |
|---|---|
| See current hiring trends | Open the dashboard artifact, or build one: `docker run --rm ghcr.io/senthilsweb/job-scout trends` |
| Query the public dataset (no clone, no account) | DuckDB against the raw URL — see [`data/README.md`](data/README.md) for the column guide + example queries |
| Load all job boards into my local DuckDB | `python tools/raw_load.py` (or `docker compose --profile trends up`) |
| Explore postings before filtering | SQL on `ats_posting_raw` — see "Raw landing table" below |
| Run the interactive notebook (shortlist + scoring) | `pip install …` then `marimo edit notebook.py` — see "Run" below |
| Run the paid resume-match sweep | `python tools/daily_match.py` (containerized: `match` job, needs `RUN_PAID_MATCH=yes`) — see "API match pipeline" |
| Point the matcher at a different deployment | `JOBMATCH_API_BASE` / `JOBMATCH_AGENT_BASE` env vars (defaults in `config.yaml`) |
| Track my own role keywords instead | Edit `targets.title_keywords` in `config.yaml`, rebuild the dashboard |

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

### Adding companies
Add one line per company under `search.ats_org_slugs_by_company` in
`config.yaml`. The value form tells the fetcher which ATS to call:

    Acme: "acme"                                    # bare string = Ashby slug
    BigCo: "bigco/BigCoExternalSite"                # tenant/site = Workday
    Startup: {slug: "startupinc", platform: "greenhouse"}   # explicit form
                                                             # (greenhouse or lever)

Slugs are sent to the ATS verbatim — case, spaces, and dots matter
(`"Flock Safety"`, `"super.com"`, `"kraken.com"` are all real slugs). To
find a slug, open the company's job board and copy the path segment, e.g.
`jobs.ashbyhq.com/claylabs` → `claylabs`. Test it with one request:

    curl https://api.ashbyhq.com/posting-api/job-board/<slug>

A 404 means a wrong slug (or the company left that ATS); a 200 with an
empty `jobs` list usually means a dormant board. Some Ashby boards
disable this public API but still publish jobs (e.g. Lime) — the fetcher
falls back to Ashby's job-board GraphQL automatically; those postings
carry no posted date.

### Raw landing table — explore before you filter
When you don't yet know what titles companies use, load **everything**
(no keyword filter) into a separate table and explore it with SQL:

    python tools/raw_load.py            # snapshot ALL postings -> ats_posting_raw
    python tools/raw_load.py --stats    # rows, top companies, top departments
    python tools/raw_load.py --test "machine learning engineer"
                                        # preview a candidate keyword: total
                                        # matches + what's NEW vs config

`ats_posting_raw` keeps fields the curated table drops — department,
team, employment type, and the **full job description** (`jd_text`, with
a `jd_sha256` fingerprint). The match sweep reads JD text from this
table first and only calls the ATS boards for postings the snapshot
doesn't cover — so analysis needs no re-scraping, and you can search
descriptions in SQL:

    -- find governance work hiding behind other titles
    SELECT company_name, title FROM ats_posting_raw
    WHERE jd_text ILIKE '%data governance%' AND title NOT ILIKE '%governance%';

Study the role landscape the same way:

    -- what do AI roles get called across companies?
    SELECT company_name, title FROM ats_posting_raw
    WHERE department = 'Engineering' AND title ILIKE '%ai%';

The matcher never reads this table, so it can hold thousands of rows at
zero LLM cost. When you know what you want, **promote** rows into
`job_posting` (dedup on company+req_id makes re-promoting free):

    python tools/raw_load.py --promote --days 30 --dry-run   # preview first
    python tools/raw_load.py --promote --days 30             # config title_keywords
    python tools/raw_load.py --promote --where "title ILIKE '%governance%'"

`--where` takes any SQL predicate over ats_posting_raw columns and
replaces the keyword filter. Each load refreshes a company's rows only
when its board fetch succeeded, so one flaky board never wipes its data.

### Trends dashboard + public data (openspec: trends-dashboard)
`--export` writes two dated parquet snapshots to `exports/`; the trends
one (facts only, no JD text) renders into a self-contained interactive
dashboard — stat tiles, target-role tracker, weekly trend, salary
ranges, paginated explorer with a click-to-read JD side panel:

    python tools/raw_load.py --export
    python tools/build_trends_report.py \
        --input exports/ats_raw_trends_20260714.parquet \
        --out exports/hiring-trends-20260714.html

`--jd target` (default) embeds JD text only for postings matching your
config keywords; `--jd all` embeds everything (local use); `--jd none`
builds the lean page. A "JD panel" toggle on the page controls whether
clicking a row opens the side panel.

**Public data:** a GitHub Action (`.github/workflows/job-scout-trends.yml`)
overwrites the single canonical `data/ats_raw_trends.parquet` daily and
tags each publish `trends/YYYYMMDD` — current data lives at one stable
URL, history is a ref, no `latest` duplicates, nothing to prune. Query
straight from DuckDB, no clone needed:

    -- current snapshot (main)
    SELECT category, COUNT(*), ROUND(MEDIAN((base_min_usd+base_max_usd)/2)) AS mid
    FROM 'https://raw.githubusercontent.com/senthilsweb/ai-agents/main/agents/job-scout/data/ats_raw_trends.parquet'
    GROUP BY 1 ORDER BY 2 DESC;

    -- point in time: swap `main` for a tag ref, e.g. trends/20260714
    FROM 'https://raw.githubusercontent.com/senthilsweb/ai-agents/trends/20260714/agents/job-scout/data/ats_raw_trends.parquet'

Column-by-column data dictionary and more example queries:
[`data/README.md`](data/README.md) (rendered right next to the parquet
on GitHub).

Copyright note: `data/` carries **facts only** (titles, companies,
locations, salary bands, dates, URLs — not copyrightable). Full job
description text is the hiring companies' content: it stays in local
exports and, when embedded in your own dashboard build, is for personal
job-search use — don't republish JD text.

### Delta vs snapshot refresh
Two `config.yaml` knobs under `search` control what a fetch loads:

- `max_posting_age_days: 30` — postings whose feed date is older than
  this are skipped at fetch time. Feeds without dates (Lever, Workday,
  Ashby-GraphQL) are always kept rather than guessed at.
- `refresh_mode: "delta"` — every fetch is naturally a delta: rows dedup
  on company+req_id, so re-running only inserts postings that are new.
  Set `refresh_mode: "snapshot"` to *also* mark previously open rows
  `closed` when their req_id has disappeared from the company's live
  board. Snapshot closing is skipped for Workday companies (that feed is
  paginated, so absence proves nothing). Closed rows are kept, never
  deleted — they simply stop being picked up by the match sweep.

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

### Docker — run the pipeline without installing anything
A public image (`ghcr.io/senthilsweb/job-scout`, amd64+arm64) carries the
tools, templates, and a default config; it is rebuilt by
`.github/workflows/job-scout-image.yml` on every push that touches the
agent. Named jobs: `load`, `export`, `report`, `trends` (all three),
`match` (paid — refuses without `RUN_PAID_MATCH=yes`); anything else is
passed through verbatim (`bash`, `python tools/... `).

    # checkout-less, self-contained (state stays in the container)
    docker run --rm ghcr.io/senthilsweb/job-scout trends

    # against this checkout: image = deps, repo = code/config/DB/exports
    docker compose --profile trends up
    docker compose --profile match up          # paid; reads ./.env
    docker compose --profile shell run --rm shell

Every compose service is profile-gated, so a bare `docker compose up`
starts nothing. For a server with its own state, mount a config whose
paths are absolute and point `JOB_SCOUT_CONFIG` at it:

    docker run --rm -v /srv/js:/state -e JOB_SCOUT_CONFIG=/state/config.yaml \
        ghcr.io/senthilsweb/job-scout trends

One-time setup: GHCR packages start private — flip
`ghcr.io/senthilsweb/job-scout` to public in GitHub package settings
after the first workflow push. Note the marimo notebook is not in the
image (interactive, local-only).

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

## API match pipeline (agent-job-matcher)

Scores every open posting against your resume using the deployed
[agent-job-matcher](https://github.com/senthilsweb/agent-job-matcher)
API, and writes a ranked HTML report. Spec:
`openspec/changes/api-match-report/`. Full reference (flags, input
contract, table schema, troubleshooting):
[docs/api-match-pipeline.md](docs/api-match-pipeline.md). Three tools:

    python tools/match_sweep.py --dry-run     # show what would be analyzed
    python tools/match_sweep.py               # analyze new/changed postings
    python tools/build_match_report.py --input <results.json> --out <report.html>
    python tools/daily_match.py               # fetch -> sweep -> render, one command

How it works, in plain terms:

1. Job pages on Ashby/Workday need JavaScript, so the API cannot read
   them from the URL. The sweep gets the full job description from the
   ATS JSON APIs instead, saves it as a text file, uploads it through
   the agent-service `/upload` endpoint, and sends the returned
   server path to `POST /analyze` together with your resume
   (`matcher.resume_path` in `config.yaml`).
2. Each job's JD text gets a SHA-256 hash, stored in the
   `api_match_result` table. A job is analyzed only when it is new or
   its JD text changed — running the sweep twice in a row makes zero
   API calls the second time. You never pay twice for the same JD.
3. Results are saved twice: one JSON file per job under
   `exports/jobmatch-YYYYMMDD/reports/` and one row per job in
   `api_match_result` (scores, match band, hash, dates).
4. The report renderer reads a results JSON file (or, in the daily
   pipeline, every analyzed job in the table) and writes one
   self-contained HTML page: ranked by score, filterable by company
   and match band, each row expandable to strengths / gaps / resume
   improvements / missing ATS keywords, with the full cover letter in
   a collapsed section inside each row. Jobs first analyzed today get
   a NEW badge in the daily report.

To adopt an old run without paying for it again (for example the
2026-07-13 session run):

    python tools/match_sweep.py --backfill exports/jobmatch-20260713/all_reports.json

Daily schedule (cron example — email delivery is not built yet, the
report is written to `exports/`):

    0 7 * * * cd /path/to/job-scout && python3 tools/daily_match.py >> logs/cron.out 2>&1

## Resume context
Convert your resume once, deterministically (no LLM):

    python tools/resume_to_md.py inputs/resume.pdf

The .md output is auto-appended to the agent system prompt as <candidate_resume>.

## Logging
Every run writes a timestamped file to logs/run_YYYYMMDD_HHMMSS.log
(plan counts, skips, exports, agentic calls). Directory and level in config.yaml.

## Layout
    config.yaml            all tunable parameters (search, thresholds, weights, matcher API)
    .env.example           secrets template (API key only)
    notebook.py            marimo app: schema → sliders → ranked view → exports → search plan → agentic
    tools/                 CLI tools: ATS fetch, sponsor load, match sweep, report render, daily pipeline
    templates/             Jinja2 template for the match report HTML
    docs/                  reference docs (api-match-pipeline.md)
    openspec/              project.md + specs (data-model, scoring, search-pipeline)
    exports/               generated CSV/Parquet + dated jobmatch-YYYYMMDD/ run dirs
