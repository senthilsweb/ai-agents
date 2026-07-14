# Data & Queries

At the end you will know which table holds what, how to explore
everything with SQL before filtering, and how to query the public
dataset from anywhere. The full schema lives in
[job_tracker.dbml](https://github.com/senthilsweb/ai-agents/blob/main/agents/job-scout/job_tracker.dbml).

## The two tables that matter most

**`ats_posting_raw` — everything, unfiltered.** Every posting from
every configured board, including department, team, employment type,
and the **full job description** (`jd_text`, with a `jd_sha256`
fingerprint). No keyword filter. This table is free to grow — nothing
paid ever reads it directly.

**`job_posting` — your shortlist.** Only postings you promoted (by
keyword or SQL filter). The paid match sweep reads **only** this table.
That boundary is structural: raw exploration can never cost money.

Supporting tables: `company` (one row per employer, enriched by the
sponsor loader), `compensation` (parsed pay bands), `api_match_result`
(match scores + JD hashes), `conference`/`sponsorship` (conference
catalogs), `fit_assessment`, `contact`, `referral`, `crawl_log`.

## Explore before you filter

When you do not yet know what titles companies use, load everything and
ask SQL:

```bash
python tools/raw_load.py            # snapshot ALL postings -> ats_posting_raw
python tools/raw_load.py --stats    # rows, top companies, top departments
```

```sql
-- find governance work hiding behind other titles
SELECT company_name, title FROM ats_posting_raw
WHERE jd_text ILIKE '%data governance%' AND title NOT ILIKE '%governance%';

-- what do AI roles get called across companies?
SELECT company_name, title FROM ats_posting_raw
WHERE department = 'Engineering' AND title ILIKE '%ai%';
```

Preview a keyword before adding it to config (see
[Configuration](configuration.md#role-keywords-targetstitle_keywords)
for the two keyword traps):

```bash
python tools/raw_load.py --test "machine learning engineer"
```

## Promote what you want

When you know what you want, move rows into the shortlist. Re-promoting
is free — rows dedup on company + req_id.

```bash
python tools/raw_load.py --promote --days 30 --dry-run   # ALWAYS preview first
python tools/raw_load.py --promote --days 30             # uses config title_keywords
python tools/raw_load.py --promote --where "title ILIKE '%governance%'"
```

`--where` takes any SQL condition over `ats_posting_raw` columns and
replaces the keyword filter. `--days N` keeps postings newer than N
days (undated postings are kept). Each load refreshes a company's rows
only when its board fetch succeeded, so one flaky board never wipes its
own data.

## The public dataset

A facts-only copy of the raw table (no JD text, ever) is published
daily:

```sql
-- current snapshot
FROM 'https://raw.githubusercontent.com/senthilsweb/ai-agents/main/agents/job-scout/data/ats_raw_trends.parquet'

-- any past day: swap main for a tag, e.g. trends/20260714
FROM 'https://raw.githubusercontent.com/senthilsweb/ai-agents/trends/20260714/agents/job-scout/data/ats_raw_trends.parquet'
```

Column-by-column guide and six ready-made queries:
[data/README.md](https://github.com/senthilsweb/ai-agents/blob/main/agents/job-scout/data/README.md).

## Query tools

- **DuckDB CLI** against the local file:
  `duckdb job_tracker.duckdb -readonly` — use `-readonly` whenever the
  pipeline might run, because DuckDB allows only one writer (see
  [Runbook](runbook.md#database-is-locked)).
- **The browser console** — hosted at
  <https://senthilsweb.github.io/ai-agents/console/> — runs DuckDB in
  the browser against any https parquet URL; its default query reads
  this project's public dataset. (Source:
  [utils/duckdb-s3-console.html](https://github.com/senthilsweb/ai-agents/blob/main/utils/duckdb-s3-console.html);
  for plain-http MinIO endpoints, serve it locally instead — a hosted
  https page cannot call http.)
- **The marimo notebook** for the interactive ranked board.

## How the tables get populated

Two independent pipelines write into `job_tracker.duckdb`. Running one
does not trigger the other.

**Postings pipeline** (config → boards → tables):

1. The notebook (or any tool) creates the schema idempotently.
2. The Tier 1 fetch reads `search.ats_org_slugs_by_company`, seeds one
   `company` row per slug, pulls live postings from each board's JSON
   API, filters titles against `targets.title_keywords`, and inserts
   into `job_posting` + `compensation` (dedup on company + req_id).
   `raw_load.py` does the same fetch without the keyword filter, into
   `ats_posting_raw`.

**Sponsors pipeline** (conference catalog → companies):

3. `fetch_sponsors_rainfocus.py` pulls a full exhibitor catalog from a
   RainFocus-hosted conference site and rule-classifies each sponsor
   (keywords and tiers — no LLM).
4. `load_sponsors.py` inserts one `conference` row, one `sponsorship`
   link per sponsor, and a `company` row for every sponsor **not
   already present**. When a sponsor matches an existing company, its
   empty fields (classification, industry, stage, notes) are
   back-filled — existing values are never overwritten. Re-runs create
   zero duplicates.

The two meet only in `company`: sponsor-only companies exist with no
board slug, so the postings pipeline cannot fetch for them until you
add a slug to config
([how](configuration.md#adding-a-company-searchats_org_slugs_by_company)).

### Conference sponsors: getting the RainFocus credentials

```bash
python tools/fetch_sponsors_rainfocus.py --load   # fetch -> classify -> load
```

The tool needs `RAINFOCUS_PROFILE_ID` (and sometimes
`RAINFOCUS_COOKIE`) in your local `.env`. `rfapiprofileid` is a
per-event request header, not published in the page HTML — pull it
from the browser:

1. Open the conference's sponsor/exhibitor directory page.
2. DevTools → **Network** tab → filter **Fetch/XHR** → reload.
3. Find the request to `events.rainfocus.com/api/exhibitors` (or
   similar) and copy the `rfapiprofileid` request header.
4. If the directory is session-gated, also copy the `Cookie` header.
5. Paste both into your local `.env` — never into a committed file.
   The id rotates between events and years, so re-extract it per
   conference.

## Local exports

`python tools/raw_load.py --export` writes two dated files to
`exports/` (git-ignored):

- `ats_raw_trends_YYYYMMDD.parquet` — the facts-only snapshot (same
  shape as the public file).
- `ats_raw_full_YYYYMMDD.parquet` — everything including `jd_text`.
  **Local use only. Never publish this file.**

Next: [Dashboards & Reports](dashboards-and-reports.md).
