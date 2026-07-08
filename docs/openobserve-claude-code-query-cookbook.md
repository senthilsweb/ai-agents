# OpenObserve Query Cookbook: Claude Code Telemetry

*Internal reference — every query used for the "Telemetry and Observability for Claude Code" article, with real results and gotchas. Data window: July 6–7, 2026.*

## Setup

- **Endpoint:** `http://localhost:5080` (public: `https://telemetry.nathansweb.com`)
- **Org:** `default` — all queries go to `POST /api/default/_search?type=metrics`
- **Auth:** HTTP Basic, root credentials (see `OTEL_EXPORTER_OTLP_HEADERS` in `~/.claude/settings.json` — not repeated here)
- **Key fact:** the OpenObserve **GUI cannot run SQL on metric streams** (the metrics page only speaks PromQL). The `_search` API with `?type=metrics` can. That one query-string parameter is what unlocks everything below.

Request shape used everywhere:

```bash
curl -X POST "http://localhost:5080/api/default/_search?type=metrics" \
  -H "Authorization: Basic <redacted>" \
  -H "Content-Type: application/json" \
  -d '{
    "query": {
      "sql": "<SQL HERE>",
      "start_time": <microseconds since epoch>,
      "end_time":   <microseconds since epoch>
    }
  }'
```

Handy time-window one-liner (last 7 days, computed in the shell):

```bash
"start_time": $(( ($(date +%s) - 7*86400) * 1000000 )),
"end_time":   $(( $(date +%s) * 1000000 ))
```

## Gotchas (learned the hard way)

| # | Gotcha | Fix |
|---|---|---|
| 1 | Timestamps are **microseconds**, not seconds or millis | Multiply epoch seconds by 1,000,000 |
| 2 | PromQL instant query (`/prometheus/api/v1/query`) returned **empty** for these counters | Claude Code exports **delta** temporality; use the SQL `_search` API instead |
| 3 | `date_format()` in SQL → HTTP 400 | Use `histogram(_timestamp, '1 hour')` for time bucketing |
| 4 | GUI won't run SQL over metrics | Use the API with `?type=metrics` |
| 5 | One row = one **metric data point**, not exactly one API call | Claude Code exports deltas every 10s (`OTEL_METRIC_EXPORT_INTERVAL=10000`); calls landing in the same window can merge. Sums are always exact; counts are ≈ |
| 6 | Counters are **moving targets** — an active session changes results between two runs of the same query | Always pin `start_time`/`end_time` and state the window when publishing numbers |

---

## Q1 — Discover the streams

What metric streams does Claude Code actually emit?

```bash
curl -s -H "Authorization: Basic <redacted>" \
  "http://localhost:5080/api/default/streams"
```

**Result:** `claude_code_token_usage`, `claude_code_cost_usage`, `claude_code_active_time_total`, `claude_code_lines_of_code_count`, `claude_code_code_edit_tool_decision`, session counts, plus log streams. Each entry includes `metrics_meta` (type, unit, help text) and `doc_time_min`/`doc_time_max` — useful for finding when telemetry actually started (ours: 2026-07-06 14:10 UTC).

## Q2 — Tokens by model and type (the article's main table)

```sql
SELECT model, type, SUM(value) AS tokens
FROM claude_code_token_usage
GROUP BY model, type
ORDER BY tokens DESC
```

**Result (window: 2026-07-06 14:10 → 2026-07-07 00:47 UTC):**

| model | type | tokens |
|---|---|---:|
| claude-sonnet-5 | cacheRead | 19,042,603 |
| claude-sonnet-5 | cacheCreation | 557,915 |
| claude-fable-5 | cacheRead | 102,396 |
| claude-sonnet-5 | output | 95,611 |
| claude-haiku-4-5 | input | 26,113 |
| claude-fable-5 | cacheCreation | 25,194 |
| claude-sonnet-5 | input | 7,866 |
| claude-fable-5 | output | 6,827 |
| claude-haiku-4-5 | output | 2,253 |
| claude-fable-5 | input | 8 |

## Q3 — Cost by model

```sql
SELECT model, SUM(value) AS usd
FROM claude_code_cost_usage
GROUP BY model
ORDER BY usd DESC
```

**Result (same window):** claude-sonnet-5 `$10.5180`, claude-fable-5 `$0.9477`, claude-haiku-4-5 `$0.0374`.

### Cost verification against published pricing

Every cost reconciled **to the cent** using: input at list price, output at list price, cache write at **2× input** (Claude Code uses the 1-hour cache TTL), cache read at **0.1× input**.

| Model | Input $/M | Output $/M | Cache write $/M | Cache read $/M |
|---|---:|---:|---:|---:|
| claude-sonnet-5 | 3 | 15 | 6 | 0.30 |
| claude-fable-5 | 10 | 50 | 20 | 1.00 |
| claude-haiku-4-5 | 1 | 5 | 2 | 0.10 |

Worked example (Sonnet): `7,866×3 + 95,611×15 + 557,915×6 + 19,042,603×0.30` (all ÷1M) = `0.0236 + 1.4342 + 3.3475 + 5.7128` = **$10.518** ✅ matches the recorded metric. Fable and Haiku reconcile identically. Conclusion: `claude_code_cost_usage` = `claude_code_token_usage` × published rates. The pipeline is trustworthy.

## Q4 — Inspect available attributes (schema discovery)

```sql
SELECT * FROM claude_code_token_usage LIMIT 2
```

**Result — each data point carries:** `model`, `type` (input/output/cacheRead/cacheCreation), `session_id`, `query_source` (main/auxiliary), `effort`, `user_email`, `user_account_uuid`, `organization_id`, `service_version` (Claude Code version), `terminal_type`, `os_type`, `host_arch`, `_timestamp`, `value`. The `session_id` attribute is what makes per-session cost attribution possible.

## Q5 — Cache reads by session (the "where did 19M tokens come from" query)

```sql
SELECT session_id, COUNT(*) AS datapoints, SUM(value) AS tokens
FROM claude_code_token_usage
WHERE type = 'cacheRead'
GROUP BY session_id
ORDER BY tokens DESC
```

**Result:**

| session_id (short) | datapoints | tokens |
|---|---:|---:|
| c6c8f54a | 67 | 14,717,656 |
| e7bdaebf | 44 | 3,599,887 |
| 542c55d9 | 17 | 584,007 |
| 9f016550 | 13 | 576,939 |

One session = 77% of all cache-read volume. Average per data point = `SUM(value)/COUNT(*)`: 219,666 for the big one.

## Q6 — Cache reads by query source

```sql
SELECT query_source, SUM(value) AS tokens
FROM claude_code_token_usage
WHERE type = 'cacheRead'
GROUP BY query_source
ORDER BY tokens DESC
```

**Result:** `main` 16,121,564 · `auxiliary` 3,356,925. "Auxiliary" is Claude Code's internal side-requests (subagents, summarization) — they carry the conversation context too.

## Q7 — Hourly profile

```sql
SELECT histogram(_timestamp, '1 hour') AS hr, SUM(value) AS tokens
FROM claude_code_token_usage
WHERE type = 'cacheRead'
GROUP BY hr
ORDER BY hr
```

**Result:**

| hour (UTC) | cacheRead tokens |
|---|---:|
| 2026-07-06 14:00 | 14,717,656 |
| 2026-07-06 21:00 | 889,214 |
| 2026-07-06 22:00 | 2,224,720 |
| 2026-07-06 23:00 | 739,834 |
| 2026-07-07 00:00 | 907,065 |

The entire 14.7M session happened inside one hour (10–11 AM EDT).

## Q8 — Largest single data points (context-size ceiling)

```sql
SELECT _timestamp, model, session_id, value
FROM claude_code_token_usage
WHERE type = 'cacheRead'
ORDER BY value DESC
LIMIT 5
```

**Result:** 809,680 (14:52 UTC) · 802,957 (14:51) · 785,756 (14:46) · 415,057 · 413,664 — all Sonnet 5, all session c6c8f54a. A single ~810K cache read means the conversation had grown to ~810K tokens (Sonnet 5's context window is 1M). Remember gotcha #5: a "single data point" can merge calls within one 10s export window, so treat these as ≈ per-call values.

## Q9 — Reproduce published numbers later (time-pinned audit)

To audit a published table, re-run the same SQL with `end_time` pinned to the original snapshot moment. Our audit: Sonnet and Haiku rows reproduced **byte-identically**; the Fable row differed because the drafting session itself was running on Fable 5 and the counter moved between snapshot and audit. Bracketing `end_time` (00:35 → 00:40 → 00:45 → 00:47 UTC) showed the counter passing through the published value — confirming the snapshot was genuine, just time-sensitive.

**Rule:** publish numbers only with their time window, and pin `end_time` when auditing.

## Timestamp conversion cheatsheet (macOS)

```bash
date -u -r 1783347033 '+%Y-%m-%d %H:%M UTC'   # epoch seconds → readable UTC
# OpenObserve _timestamp and doc_time_* are MICROseconds: divide by 1,000,000 first
```

---

## Reusable insight formulas

- **Cache-read volume** ≈ conversation size × number of API calls. Grows ~quadratically with session length.
- **Cost sanity check** = tokens × list price, with cache write at 2× input (1h TTL) and cache read at 0.1× input.
- **Expensive-session finder** = Q5. Run it weekly; the top row is your optimization target.
- **Total tokens** = input + output + cacheCreation + cacheRead — never quote `input` alone; it's typically <1% of real volume.
