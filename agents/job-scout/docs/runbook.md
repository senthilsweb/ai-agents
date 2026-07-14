# Runbook

At the end you will know what runs automatically and when, how to check
it, how to run the paid match safely, and the fix for every failure
seen so far.

## What runs automatically

| Workflow | Schedule | Does | Needs |
|---|---|---|---|
| [job-scout daily trends](https://github.com/senthilsweb/ai-agents/blob/main/.github/workflows/job-scout-trends.yml) | daily 11:00 UTC + manual | fetch all boards → export → overwrite `data/ats_raw_trends.parquet` → tag `trends/YYYYMMDD` | nothing (default token) |
| [job-scout image](https://github.com/senthilsweb/ai-agents/blob/main/.github/workflows/job-scout-image.yml) | on push touching the agent + manual | rebuild `ghcr.io/senthilsweb/job-scout` (amd64 + arm64) | nothing (default token) |

Check them: repo **Actions** tab, or

```bash
gh run list --workflow=job-scout-trends.yml --limit 3
gh run list --workflow=job-scout-image.yml --limit 3
```

Both are manually dispatchable (**Run workflow** button, or
`gh workflow run job-scout-trends.yml`).

The daily data publish and the image build are deliberately
independent: a broken image build never stops the data refresh.

## Running the paid match

Every selected posting is one call to the paid matcher API. The
procedure that keeps this safe:

1. **Dry-run first, always.** See what would be analyzed and what it
   would cost — a dry run makes zero API calls:

   ```bash
   python tools/match_sweep.py --dry-run
   ```

2. Only new or changed postings are ever sent: each JD's SHA-256 hash
   is stored in `api_match_result`, and unchanged hashes are skipped.
   Running the sweep twice in a row costs nothing the second time.

3. Run it:

   ```bash
   python tools/daily_match.py        # fetch -> sweep -> report
   # containerized: needs the guard set explicitly
   docker compose --profile match up  # RUN_PAID_MATCH=yes is set in the service
   ```

   Expect roughly 3 jobs per API request (`matcher.batch_size`) and a
   few minutes per batch. Results land in
   `exports/jobmatch-YYYYMMDD/` and in the `api_match_result` table.

4. To adopt an old run's results without paying again:

   ```bash
   python tools/match_sweep.py --backfill exports/jobmatch-20260713/all_reports.json
   ```

Before real scheduled runs, point `matcher.resume_path` at your actual
resume — the committed value is a placeholder.

## Failures and fixes

### Database is locked

`Could not set lock on file` — DuckDB allows one writer. An open
`duckdb job_tracker.duckdb` shell (or the notebook) holds the lock.
Close it, or open read-only sessions with:

```bash
duckdb job_tracker.duckdb -readonly
```

### Every board fetch fails silently (macOS)

Python is missing TLS root certificates. Install `certifi`
(`pip install certifi`) — the tools pick it up automatically.

### One company returns nothing

- **404** → wrong slug, or the company left that board. Slugs are sent
  verbatim — check case, spaces, dots
  ([Configuration](configuration.md#adding-a-company-searchats_org_slugs_by_company)).
- **200 with empty `jobs`** → dormant board (the company posts
  elsewhere), or an Ashby board with the public API disabled — the
  fetcher falls back to Ashby GraphQL automatically (those postings
  have no dates).
- **Workday boards** return at most one page (NVIDIA caps at 20
  postings). This is the feed's behavior, not a bug.

### Postings you expect are missing from the shortlist

Check the raw table first — the posting is usually there but not
promoted:

```bash
python tools/raw_load.py --test "your keyword"     # does it match?
python tools/raw_load.py --promote --days 30 --dry-run
```

### Rows never close

`refresh_mode: delta` never closes anything. Switch to `snapshot`
(closes rows whose id left the live board — skipped for Workday), or
accept that closed postings are filtered out later by the sweep's
harvest step.

### The daily data workflow failed

Open the run log in the Actions tab. The usual causes: a board API
outage (re-dispatch later — the pipeline is idempotent) or a GitHub
push conflict from a concurrent manual run (the concurrency group
prevents overlap; just re-run). A failed day is not lost data — the
next successful run publishes the current state and its tag.

### `docker pull` cannot find the image

The GHCR package must be public: GitHub → your packages →
`job-scout` → settings → change visibility. One-time step.

### Notebook board does not refresh

marimo re-runs a cell only when an upstream variable is *reassigned*.
The fetch button mutates the database in place, so the ranked board
does not notice. Re-run the board cell manually (or "Run all cells")
after any fetch or load.

## Logs

Every tool run writes `logs/run_YYYYMMDD_HHMMSS.log` (plan counts,
skips, exports, agentic calls). Directory and level are set in
`config.yaml` under `logging`. The `logs/` folder is git-ignored.

Next: [CI/CD](ci-cd.md).
