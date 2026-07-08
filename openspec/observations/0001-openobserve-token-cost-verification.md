# Observation 0001 — OpenObserve token/cost verification for the shared telemetry pipeline

- **Status**: Confirmed by live query; one finding unresolved
- **Date**: 2026-07-07
- **Scope**: Monorepo-wide — `shared/lib/instrumentation.ts`, `shared/lib/telemetry.ts`,
  `shared/hooks/usage.ts`, `shared/lib/cost.ts`, `shared/cost/rates.yaml`. Verified
  against `agents/linkedin-cover-generator` (run `2026-07-07T13-56-33Z`, session
  `wrun_01KWYDVAKBJAJW5AWRR5ZN170N`, trace `caff80c55f73b9250c92b932a85733f7`), but
  every finding below is about the shared pipeline, not agent-specific code — it
  applies to any agent that adopts `createAgentInstrumentation()`.
- **Related**: ADR 0001 (Shared Agent Runtime Kit), ADR 0002 (Cost Matrix),
  `agents/linkedin-cover-generator/docs/run-with-telemetry.md`,
  `agents/linkedin-cover-generator/docs/observability-internals.md`,
  `agents/linkedin-cover-generator/docs/telemetry-eval-queries.md`.

## Context

ADR 0002 defines `shared/lib/cost.ts` + `shared/cost/rates.yaml` as the
monorepo's cost pipeline, fed by `shared/hooks/usage.ts` observing eve's
`step.completed` event — a **non-OTel** path that produces each run's
`summary.json`. Separately, `shared/lib/instrumentation.ts` exports OTel spans
carrying token counts to Phoenix and/or OpenObserve. These are two independent
pipelines that happen to describe the same model calls. This observation
records what live querying OpenObserve actually returns, since no prior doc
in the repo had queried anything beyond `operation_name`/`service_name`/
`duration`/`trace_id` on the traces stream.

## Finding 1 — OpenObserve's column-naming convention for OTel span attributes

OpenObserve flattens OTel span attributes directly onto the `default` traces
stream as top-level columns: dots become underscores, no `attributes.` map
wrapper. Confirmed on real `gen_ai.client` (LLM-kind) spans:

`llm_model_name`, `llm_provider`, `llm_token_count_prompt`,
`llm_token_count_completion`, `llm_token_count_total`,
`llm_token_count_prompt_details_cache_read`,
`llm_token_count_prompt_details_cache_write`, `gen_ai_usage_input_tokens`,
`gen_ai_usage_output_tokens`, `gen_ai_usage_cache_read_input_tokens`,
`gen_ai_usage_cost`, `metadata_eve_session_id`,
`ai_settings_context_eve_session_id`.

These columns are typed `Utf8View` (string), not numeric — `SUM()`/`ROUND()`
need an explicit `CAST(col AS DOUBLE)` or the query fails with
`20008 Search SQL execute error: Function 'sum' failed to match any signature`.

One caveat: a custom attribute literally named `operation.name` collided with
OpenObserve's built-in `operation_name` column and was stored as
`attr_operation_name` instead — a namespacing quirk to watch for with any
attribute name that shadows a built-in trace column.

## Finding 2 — `gen_ai.usage.cost` is a permanent stub, on both backends

Every LLM-kind span carries a `gen_ai_usage_cost` attribute. Every value
observed across every span in the reference run was `-0.0`. Nothing in this
stack — the Vercel AI SDK, eve, or `shared/lib/instrumentation.ts` —
populates real pricing into it. Phoenix has its own separate cost feature
(Settings → Model pricing, matched on `llm_model_name`) which this repo has
also not configured. **Neither telemetry backend computes real dollar cost
today.** `shared/lib/cost.ts` + `shared/cost/rates.yaml` (ADR 0002) remains
the only pipeline that produces an actual cost figure, and only for model ids
an operator has populated in `rates.yaml`.

## Finding 3 — every model call produces two LLM-kind spans; naive SUM double-counts

The Vercel AI SDK emits **two** spans with `openinference_span_kind=LLM` per
real model call: an outer step-level span and an inner `.doGenerate` child.
Both carry **identical** token-count attributes (confirmed: same
`llm_token_count_prompt` value, `span_id`s a few milliseconds apart). Only the
outer span carries `metadata_eve_session_id` (from eve's
`ai.telemetry.metadata`, attached via `step.started`'s `runtimeContext`) — the
inner `.doGenerate` span does not.

**Any `SUM(llm_token_count_*)` grouped only by `service_name`/`trace_id`
double-counts every call.** The fix verified live:

```sql
-- WRONG: double-counts (includes both the outer span and its .doGenerate child)
SELECT SUM(CAST(llm_token_count_prompt AS DOUBLE)) FROM "default"
WHERE service_name = 'linkedin-cover-generator' AND llm_model_name = 'claude-sonnet-5'
-- → 561,356 prompt tokens (24 spans) for a run that made 12 real calls

-- RIGHT: filter to the one span per call that carries eve's session metadata
SELECT SUM(CAST(llm_token_count_prompt AS DOUBLE)) FROM "default"
WHERE service_name = 'linkedin-cover-generator' AND llm_model_name = 'claude-sonnet-5'
  AND metadata_eve_session_id IS NOT NULL
-- → 280,678 prompt tokens (12 spans) — exactly half
```

## Verified cost query (mirrors `rates.yaml`'s claude-sonnet-5 pricing)

`shared/lib/cost.ts`'s `estimateModelCost()` never bills cache-*write* tokens
(only input, output, and cache-*read*, the last discounted by
`defaults.cache.read_discount`) — this SQL matches that formula exactly, so
it stays consistent with what `summary.json` would report if fully populated:

```sql
SELECT trace_id, metadata_eve_session_id, COUNT(*) AS calls,
  SUM(CAST(llm_token_count_prompt AS DOUBLE)) AS prompt_tokens,
  SUM(CAST(llm_token_count_completion AS DOUBLE)) AS completion_tokens,
  ROUND(
    SUM(CAST(llm_token_count_prompt AS DOUBLE)) * 0.000002      -- $2/1M input
    + SUM(CAST(llm_token_count_completion AS DOUBLE)) * 0.00001  -- $10/1M output
    + SUM(CAST(llm_token_count_prompt_details_cache_read AS DOUBLE)) * 0.0000002, -- 10% of input rate
  6) AS est_cost_usd
FROM "default"
WHERE service_name = 'linkedin-cover-generator'
  AND llm_model_name = 'claude-sonnet-5'
  AND metadata_eve_session_id IS NOT NULL
GROUP BY trace_id, metadata_eve_session_id
```

Result for the reference run: 12 calls, 280,678 prompt tokens, 4,927
completion tokens, **est. $0.658895**.

## Open question — OTel-derived cost is ~1.6x the `summary.json` figure

The same run's `summary.json` (produced by `shared/hooks/usage.ts` +
`shared/lib/cost.ts`) reports only **8 "steps"**, 170,876 input tokens, 4,085
output tokens, and **$0.409673** — noticeably lower than the deduplicated
OTel figures above (12 calls / 280,678 / 4,927 / $0.658895).

Ruled out: subagent delegation. Only one `eve.session.id`
(`wrun_01KWYDVAKBJAJW5AWRR5ZN170N`) appears anywhere in the trace, so a
child-agent session silently splitting off its own usage file is not the
explanation.

Leading hypothesis, **not yet confirmed**: `shared/hooks/usage.ts`'s
`step.completed` handler does `if (!usage) return;` — any step whose event
lacks a `usage` field is silently dropped from the accumulator, which would
undercount both `steps` and every token total in `summary.json`. This has not
been verified by reading eve's internals or instrumenting the hook itself.

**Action needed if accurate cost tracking matters**: instrument
`shared/hooks/usage.ts` to log (not silently return on) `step.completed`
events with no `usage` field, and compare the count against the OTel-visible
call count for the same session, to confirm or rule out this hypothesis.
