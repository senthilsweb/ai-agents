# Configuration

At the end you will know what every `config.yaml` section does, how to
add a company or a role keyword safely, and which environment variables
override what. All tunable behavior lives in
[config.yaml](https://github.com/senthilsweb/ai-agents/blob/main/agents/job-scout/config.yaml);
secrets live only in `.env`.

## config.yaml, section by section

| Section | Controls |
|---|---|
| `candidate` | your name, resume path, location, work authorization — used by scoring and the matcher |
| `targets` | role keywords, salary floor, preferred locations, domain boosts |
| `scoring` | the ranked board's weights and gates |
| `logging` | log directory and level |
| `database` | DuckDB file path and export directory |
| `search` | the company/board list and fetch behavior |
| `matcher` | the paid match API endpoints and batch size |
| `agentic` | the optional LLM search fallback (off by default) |

### Role keywords (targets.title_keywords)

```yaml
targets:
  title_keywords:
    - "ai engineer"
    - "engineering manager"
    - "forward deployed engineer"
```

Matching is deliberately forgiving: filler and seniority words
(senior, sr, staff, principal, lead, of, and…) are ignored, so
"Sr. Engineering Manager, Data Platform" matches "engineering manager".
Keywords with one or two meaningful words need all of them in the
title; longer keywords tolerate one missing word.

Two traps to know before adding a keyword:

- A keyword whose meaningful part collapses to one common word matches
  far too much. "staff engineer" reduces to just "engineer" — about
  1,800 matches.
- Three-word keywords only need two words to match. "technical program
  manager" also matches plain "program manager" titles.

**Always preview a keyword before adding it:**

```bash
python tools/raw_load.py --test "machine learning engineer"
# shows: total matches + how many are NEW versus your current keywords
```

### Adding a company (search.ats_org_slugs_by_company)

A *slug* is the short name in a job board's URL
(`jobs.ashbyhq.com/claylabs` → `claylabs`). One line per company; the
value's shape tells the fetcher which board system to call:

```yaml
search:
  ats_org_slugs_by_company:
    Acme: "acme"                                          # bare string = Ashby
    BigCo: "bigco/BigCoExternalSite"                      # tenant/site = Workday (host wd5)
    OtherCo: "otherco/OtherCoCareers/wd3"                 # tenant/site/host = Workday, non-default host
    Startup: {slug: "startupinc", platform: "greenhouse"} # explicit (greenhouse or lever)
```

For Workday, the tenant and host are the first two labels of the job
board's hostname (`aveva.wd3.myworkdayjobs.com` → tenant `aveva`, host
`wd3`) and the site is the path segment after it. When the host is the
default `wd5` the third segment can be omitted. Some companies hide
their Workday board behind a branded front-end (HPE behind Phenom,
Cohesity behind an AEM proxy) — a posting's *apply* URL reveals the real
`tenant.host.myworkdayjobs.com/site` to configure.

Slugs are sent to the board exactly as written — case, spaces, and dots
matter (`"Flock Safety"`, `"super.com"`, `"kraken.com"` are all real
slugs). Test one before committing:

```bash
curl "https://api.ashbyhq.com/posting-api/job-board/<slug>"
```

A 404 means a wrong slug (or the company left that board). A 200 with
an empty `jobs` list usually means a dormant board. Some Ashby boards
disable this public API but still publish jobs (Lime, for example) —
the fetcher falls back to Ashby's GraphQL automatically; those postings
carry no posted date.

### Fetch behavior (search)

```yaml
search:
  max_posting_age_days: 30    # skip feed postings older than this
  refresh_mode: "delta"       # or "snapshot"
  verify_before_insert: false # optional live open/closed check
```

- `max_posting_age_days` — postings older than this are skipped at
  fetch time. Boards that send no dates are always kept, never guessed.
- `refresh_mode: delta` — every fetch only inserts postings that are
  new (rows dedup on company + req_id). `snapshot` additionally marks
  previously open rows `closed` when their id has disappeared from the
  live board. Snapshot closing is skipped for Workday boards (their
  feed is paginated, so absence proves nothing). Closed rows are kept,
  never deleted.

### Scoring the ranked board (scoring)

```yaml
scoring:
  weights:                    # must sum to 1.0
    domain_fit: 0.50
    compensation: 0.35
    hls_bonus: 0.15
  comp_norm_divisor_usd: 280000
  location_penalty_out_of_state: 0.7
  visa_gate: true             # no visa sponsorship -> score 0
  freshness_max_age_days: 45  # older postings get flagged stale
```

The notebook's sliders adjust the same knobs live; the config values
are the defaults they start from.

### The paid match API (matcher)

```yaml
matcher:
  api_base: "https://jobmatch-api.nathansweb.com"     # POST /analyze
  agent_base: "https://jobmatch-agent.nathansweb.com" # POST /upload
  resume_path: "./inputs/sk-resume-june-2026.md"      # PLACEHOLDER — point at your real resume
  batch_size: 3
```

Both endpoints can be overridden per run with environment variables
(next section) — useful for containers and for testing against a
different deployment. The committed `resume_path` is a placeholder on
purpose; personal files are never committed. Convert your resume once,
deterministically (no LLM), and point `resume_path` at the output:

```bash
python tools/resume_to_md.py inputs/resume.pdf
```

Full matcher reference: [API match pipeline](api-match-pipeline.md).

## Environment variables

Environment always wins over `config.yaml`. Empty values count as
"not set".

| Variable | Effect | Used by |
|---|---|---|
| `JOB_SCOUT_CONFIG` | path to an alternate config file; absolute paths inside it are used as-is | all tools (containers) |
| `JOBMATCH_API_BASE` | overrides `matcher.api_base` | match sweep |
| `JOBMATCH_AGENT_BASE` | overrides `matcher.agent_base` | match sweep |
| `RUN_PAID_MATCH` | must be `yes` for the container `match` job to run at all | Docker entrypoint |
| `EXPORT_DIR` | where the container `report`/`trends` jobs look for exports (default `/app/exports`) | Docker entrypoint |
| `ANTHROPIC_API_KEY` | enables the notebook's agentic mode (with `agentic.enabled: true`) | notebook |
| `RAINFOCUS_PROFILE_ID`, `RAINFOCUS_COOKIE` | conference sponsor fetch | sponsor tools |

## Where things must NOT go

- Secrets: only in `.env` (git-ignored) — never in `config.yaml`.
- Personal files (resume, the DuckDB file, exports, logs): all
  git-ignored; the committed `resume_path` stays a placeholder.
- Job-description text: never in `data/` or any public export — see
  [FAQ: the copyright boundary](faq.md#why-does-the-public-dataset-exclude-job-descriptions).

Next: [Data & Queries](data-and-queries.md).
