---
title: Telemetry Eval Queries
description: The exact Phoenix REST/GraphQL and OpenObserve SQL queries used to verify and analyze exported traces — copy-paste ready.
order: 3
updated: 2026-07-07
---

# Telemetry Eval Queries

Every query below was executed against a real run of this agent
(session `wrun_01KWYDVAKBJAJW5AWRR5ZN170N`, 2026-07-07) to verify the
dual-backend export described in [Run with Telemetry](./run-with-telemetry.md).
Replace hosts/credentials with your own. Conventions:

- **Phoenix** — local, `http://localhost:6006`, no auth.
- **OpenObserve** — `https://<your-openobserve>/api/<org>`; org here is
  `default`, and OTLP traces land in the traces **stream** also named
  `default`. Auth is HTTP Basic (`Authorization: Basic <base64 user:password>`).
- OpenObserve SQL runs through the `_search` API; `start_time`/`end_time`
  in the request body are **microseconds** since epoch, while the
  `start_time` *column* on spans is **nanoseconds**.

## 1. Liveness / smoke tests

Phoenix UI + collector up:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:6006          # 200 = UI up
```

OpenObserve accepts authenticated OTLP/HTTP trace posts (200 even for an
empty batch — proves URL + auth without sending data):

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  "$OO/v1/traces" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Basic $OO_TOKEN" \
  -d '{"resourceSpans":[]}'
# with OO=https://<host>/api/default and OO_TOKEN=<base64 user:password>
```

The agent-side source of truth is the `eve dev` startup line — it lists
every endpoint that will receive spans:

```
[telemetry] linkedin-cover-generator: exporting traces to http://localhost:6006/v1/traces, https://<host>/api/default/v1/traces
```

## 2. Arize Phoenix

### REST — list projects

Spans land in the `default` project unless `PHOENIX_PROJECT_NAME` is set:

```bash
curl -s http://localhost:6006/v1/projects
```

### REST — latest spans (what arrived, when)

```bash
curl -s "http://localhost:6006/v1/projects/default/spans?limit=100"
```

Used during the run to confirm spans were flowing *while the agent was
still working* (the `SimpleSpanProcessor` exports each span as it closes —
no batching delay). Quick shape-of-traffic summary over that response:

```bash
curl -s "http://localhost:6006/v1/projects/default/spans?limit=100" | python3 -c "
import json,sys
spans = json.load(sys.stdin).get('data', [])
names = {}
for s in spans: names[s['name']] = names.get(s['name'], 0) + 1
for k, v in sorted(names.items(), key=lambda x: -x[1]): print(f'{v:3d}  {k}')
"
```

Typical output for one cover run — the span vocabulary to expect:

```
 11  gen_ai
  8  world.events.create attr_set
  7  world.events.list
  6  workflow.run workflow//eve//turnWorkflow
  5  step.execute / step.hydrate / step.dehydrate ...
  4  gen_ai.client
      fetch POST https://api.anthropic.com/v1/messages
      cover.image_generation (custom span)
```

### GraphQL — per-project trace/token rollup

```bash
curl -s -X POST http://localhost:6006/graphql -H "Content-Type: application/json" \
  -d '{"query":"{ projects { edges { node { name traceCount tokenCountTotal } } } }"}'
```

### UI filters

In the Phoenix UI (http://localhost:6006 → *default* project):

- correlate a run folder with its trace: `runs/<id>/summary.json` →
  `perSession[].sessionId` → filter spans on `eve.session.id`
- find the slow step: sort root spans by latency — `cover.image_generation`
  dominates (~90s typical)
- cover-specific attributes to filter on: `cover.orchestrator_model`,
  `cover.image_model`

## 3. OpenObserve (SQL over the `_search` API)

All queries: `POST $OO/_search?type=traces` with the Basic auth header and
a JSON body of the form

```json
{"query": {"sql": "<SQL>", "from": 0, "size": 100,
 "start_time": <µs epoch>, "end_time": <µs epoch>}}
```

A convenient way to build the time window in bash (last 20 minutes):

```bash
START=$(( ($(date +%s) - 1200) * 1000000 ))
END=$((   $(date +%s)          * 1000000 ))
```

### Which trace streams exist, and are they growing?

```bash
curl -s -H "Authorization: Basic $OO_TOKEN" "$OO/streams?type=traces"
# → stream "default": doc_num, doc_time_min/max — a rising doc_num +
#   recent doc_time_max is the cheapest "spans are arriving" check
```

### Latest spans for this agent

```sql
SELECT operation_name, service_name, start_time
FROM "default"
WHERE service_name = 'linkedin-cover-generator'
ORDER BY start_time DESC
LIMIT 5
```

Used mid-run to prove OpenObserve was receiving the *same* spans as
Phoenix (matching operation names and timestamps).

### Volume check — spans and traces for a run window

```sql
SELECT COUNT(*) AS spans, COUNT(DISTINCT trace_id) AS traces
FROM "default"
WHERE service_name = 'linkedin-cover-generator'
```

One full cover run produced **272 spans across 7 traces** (the turn plus
eve workflow housekeeping traces).

### Useful follow-ups (same API, verified schema)

Span counts by operation — the OpenObserve mirror of the Phoenix shape
summary above:

```sql
SELECT operation_name, COUNT(*) AS n
FROM "default"
WHERE service_name = 'linkedin-cover-generator'
GROUP BY operation_name
ORDER BY n DESC
LIMIT 20
```

Slowest operations (duration is in microseconds):

```sql
SELECT operation_name, MAX(duration) AS max_us, AVG(duration) AS avg_us
FROM "default"
WHERE service_name = 'linkedin-cover-generator'
GROUP BY operation_name
ORDER BY max_us DESC
LIMIT 10
```

Verified output from the reference run — the image API dominates, exactly
as the custom `cover.image_generation` span was added to show:

```
workflow.execute turnWorkflow                            max 147.7s
step.execute turnStep                                    max 109.3s
fetch POST https://api.openai.com/v1/images/generations  max 103.2s
```

All spans of one trace (drill into a single run):

```sql
SELECT operation_name, start_time, duration
FROM "default"
WHERE trace_id = '<trace_id from a previous query>'
ORDER BY start_time
```

## 4. What about PromQL?

Nothing here uses PromQL: the shared pipeline currently exports **traces
only**. `counter()` / `histogram()` in `shared/lib/telemetry.ts` are safe
no-ops — no `MeterProvider` is registered yet (see
[Observability Internals](./observability-internals.md), layer F). When
metrics export is wired, OpenObserve's `/api/default/prometheus/api/v1/query`
endpoint is the natural PromQL surface.
