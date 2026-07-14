# Tech hiring trends — public dataset

`ats_raw_trends.parquet` is a daily snapshot of open job postings,
read directly from ~95 technology companies' own job boards (Ashby,
Greenhouse, Workday public JSON APIs — no page scraping). It is
rebuilt every day at 11:00 UTC by
[`job-scout-trends.yml`](../../../.github/workflows/job-scout-trends.yml).

The file holds **facts only** — titles, companies, locations, pay
bands, dates, links. It never holds job-description text (that text
belongs to the hiring companies), resume data, or match scores.

## Getting the data

Current snapshot — one stable URL:

```
https://raw.githubusercontent.com/senthilsweb/ai-agents/main/agents/job-scout/data/ats_raw_trends.parquet
```

Any past day — replace `main` with a date tag (`trends/YYYYMMDD`; one
tag is created per daily publish):

```
https://raw.githubusercontent.com/senthilsweb/ai-agents/trends/20260714/agents/job-scout/data/ats_raw_trends.parquet
```

DuckDB reads these URLs directly — no download, no account:

```sql
SELECT count(*) FROM 'https://raw.githubusercontent.com/senthilsweb/ai-agents/main/agents/job-scout/data/ats_raw_trends.parquet';
```

## Column guide

| Column | Meaning |
|---|---|
| `company_name` | Company that published the posting. |
| `ats_platform` | Job-board system: `ashby`, `greenhouse`, or `workday`. |
| `req_id` | The posting's id on that board. `company_name + req_id` is unique. |
| `title` | Job title, exactly as published. |
| `department` | Department, as published. Empty when the board sends none. |
| `team` | Team within the department, when the board shares it. |
| `employment_type` | `FullTime`, `Contract`… when the board shares it. |
| `location` | Free text, exactly as published ("Remote — US", "NYC / SF"…). Not normalized. |
| `work_mode` | `remote` / `hybrid` / `onsite` when the board shares it. |
| `comp_summary` | The pay text exactly as published, e.g. `"$165K – $216.5K • Offers Equity"`. |
| `posted_date` | Date from the feed. Empty for boards that send none (e.g. Lime, NVIDIA). Greenhouse dates mean "last updated", not "first posted". |
| `apply_url` | Link to the posting on the company's board. |
| `fetched_at` | When the pipeline read the posting (UTC). |
| `industry` | Company tag from the pipeline's own company list. May be empty. |
| `classification` | Company tag (e.g. conference-sponsor class). May be empty. |
| `category` | Nine-bucket grouping derived from department (title decides when department is empty): Engineering & Tech, Sales & GTM, Marketing, Design, Product, People & Talent, Finance & Legal, Operations & CX, Other. |
| `base_min_usd` | Low end of the published pay band, parsed to a number. USD only; empty when not published or not USD. |
| `base_max_usd` | High end of the published pay band. Same rules. |

Reading notes: salaries are never estimated or converted — non-USD
bands stay in `comp_summary` but the parsed columns are empty. A
posting appears once per board entry, exactly as the company lists it.
NVIDIA's feed is capped at 20 postings by its own pagination.

## Example queries

Top hiring companies right now:

```sql
SELECT company_name, count(*) AS open_roles
FROM 'https://raw.githubusercontent.com/senthilsweb/ai-agents/main/agents/job-scout/data/ats_raw_trends.parquet'
GROUP BY 1 ORDER BY 2 DESC LIMIT 15;
```

Median pay band midpoint by category (published USD bands only):

```sql
SELECT category,
       count(*) FILTER (base_max_usd IS NOT NULL)          AS with_salary,
       round(median((base_min_usd + base_max_usd) / 2))    AS median_mid_usd
FROM 'https://raw.githubusercontent.com/senthilsweb/ai-agents/main/agents/job-scout/data/ats_raw_trends.parquet'
GROUP BY 1 ORDER BY 3 DESC NULLS LAST;
```

Postings per week (boards that share dates):

```sql
SELECT date_trunc('week', posted_date) AS week, count(*) AS postings
FROM 'https://raw.githubusercontent.com/senthilsweb/ai-agents/main/agents/job-scout/data/ats_raw_trends.parquet'
WHERE posted_date IS NOT NULL
GROUP BY 1 ORDER BY 1;
```

Remote share by category:

```sql
SELECT category,
       round(100.0 * count(*) FILTER (work_mode = 'remote') / count(*), 1) AS remote_pct
FROM 'https://raw.githubusercontent.com/senthilsweb/ai-agents/main/agents/job-scout/data/ats_raw_trends.parquet'
GROUP BY 1 ORDER BY 2 DESC;
```

Find roles by title words (day-over-day, using a tag for the earlier day):

```sql
WITH today AS (SELECT * FROM 'https://raw.githubusercontent.com/senthilsweb/ai-agents/main/agents/job-scout/data/ats_raw_trends.parquet'),
     before AS (SELECT * FROM 'https://raw.githubusercontent.com/senthilsweb/ai-agents/trends/20260714/agents/job-scout/data/ats_raw_trends.parquet')
SELECT (SELECT count(*) FROM today  WHERE title ILIKE '%ai engineer%') AS today,
       (SELECT count(*) FROM before WHERE title ILIKE '%ai engineer%') AS before;
```

## Build it yourself

The pipeline and the dashboard renderer are in this repo
([`agents/job-scout`](..)); a ready-to-use image is published at
`ghcr.io/senthilsweb/job-scout`:

```
docker run --rm ghcr.io/senthilsweb/job-scout trends
```
