# ADR 0002 — Cost Matrix (single source of truth)

- **Status**: Accepted
- **Date**: 2026-06-22
- **Scope**: Monorepo-wide; consumed by `shared/lib/cost.ts` and every agent's reporter
- **Supersedes**: per-agent `cost_rates.md` rate cards (they become pointers to this file)

## Context

Cost rates were defined only in `diagram-generator/agent/skills/cost_rates.md`.
The other agents either guessed or skipped cost. Per ADR 0001, the rate card
becomes a single versioned artifact at `shared/cost/rates.yaml`, and per-agent
`cost_rates.md` skills point at it.

The monorepo is **model-agnostic** (ADR 0001 §4). The cost matrix MUST NOT pin a
provider or brand. It is a **lookup table keyed by whatever model ids the
operator configures** in their `.env`. Rows are populated by the operator from
their provider's pricing page; unknown ids record tokens but mark cost `n/a`.

> Rates are per **1,000,000 tokens**, USD. They are operator-supplied estimates
> and MUST be verified against the provider's pricing page before any cost
> figure is trusted. Unknown models record tokens but mark cost `n/a`.

## Decision — `shared/cost/rates.yaml`

The shipped file contains the schema and **placeholder rows only**. Operators add
rows keyed by the exact model ids they set in `MODEL_*` env vars. No brand or
model id is committed.

```yaml
version: 1
currency: USD
mode: per_token            # per_token | per_request
updated: 2026-06-22

# per_token: USD per 1,000,000 tokens, matched by the exact model id a phase used.
# Operator fills these in from their provider pricing page. Keys MUST equal the
# values configured in MODEL_ORCHESTRATOR / MODEL_SCOUT / MODEL_* etc.
per_token:
  default: { input: 0.00, output: 0.00 }   # fallback -> cost reported "n/a"

  # --- examples (replace the placeholder keys with your real model ids) ---
  # "<reasoning-class-model-id>":    { input: 0.00, output: 0.00 }  # orchestrator
  # "<fast-non-reasoning-model-id>": { input: 0.00, output: 0.00 }  # scout / reporter

# per_request: e.g. credit / premium-request billing.
# run cost = sum over phases of (usd_per_premium_request * multiplier[model])
per_request:
  usd_per_premium_request: 0.00
  multipliers: {}            # "<model-id>": 1.00

cache:
  read_discount: 0.10        # cache-read tokens billed at this fraction of input rate; adjust per provider

notes:
  - "Model-agnostic: keys are the operator's configured model ids, not brands."
  - "Any model or AI gateway is swappable in .env via Eve's adapters; the rate card follows the configured ids."
  - "Verify all rates against the provider pricing page before relying on a cost figure."
  - "Unknown model id => tokens recorded, cost reported 'n/a'."
```

## Cost compute (`shared/lib/cost.ts`)

- **per_token**: `cost = input/1e6 * rate.input + output/1e6 * rate.output`,
  with cache-read tokens charged at `rate.input * cache.read_discount`.
- **per_request**: `cost = Σ phases (usd_per_premium_request * multiplier[model])`.
- Always set `estimated: true`; never present cost as authoritative.
- A model id absent from the rate card yields `cost: n/a` for that phase while
  still recording its tokens.

## `summary.json` cost block (every run)

```jsonc
{
  "tokens": { "input": 0, "output": 0, "total": 0, "by_phase": {}, "source": "runtime|usage-file|partial|unavailable" },
  "cost":   { "currency": "USD", "mode": "per_token", "total": 0, "by_phase": {}, "estimated": true, "note": "" }
}
```

## Worked example (illustrative, rates are placeholders)

Orchestrator (reasoning-class) 40k in / 8k out at `rI/rO`; reporter
(fast non-reasoning) 12k in / 3k out at `rI'/rO'`:

```
orchestrator = 40000/1e6*rI  + 8000/1e6*rO
reporter     = 12000/1e6*rI' + 3000/1e6*rO'
total        = orchestrator + reporter      (estimated)
```

Plug in your provider's per-1M rates for the model ids you configured.

## Related
- ADR 0001 — Shared Agent Runtime Kit (defines model-agnostic selection and who
  consumes this matrix).
