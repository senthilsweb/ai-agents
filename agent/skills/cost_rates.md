---
description: Token cost rate-card for the Diagram Reporter. Load when computing token cost in a report (only with allow_cost=true).
---

# Token Cost Rate-Card

These values are the cost-rates used by the reporter. EXAMPLE VALUES —
placeholders only. Verify against your provider's pricing or your Copilot plan
and update before trusting any cost figure.

```yaml
version: 1
currency: USD
mode: per_token            # per_token | per_request

# ---- per_token mode: USD per 1,000,000 tokens, matched by the model name a phase used ----
per_token:
  default:             { input: 0.00, output: 0.00 }   # fallback -> phase cost marked n/a
  "Claude Opus 4.6":   { input: 5.00,  output: 25.00 }
  "Claude Sonnet 4":   { input: 3.00,  output: 15.00 }
  "Claude Haiku 4.5":  { input: 0.80,  output: 4.00 }
  "GPT-5.4":           { input: 1.25,  output: 10.00 }
  "GPT-5.4-mini":      { input: 0.25,  output: 2.00 }

# ---- per_request mode (e.g. Copilot premium requests / credits) ----
# run cost = sum over phases of (usd_per_premium_request * multiplier[model])
per_request:
  usd_per_premium_request: 0.04
  multipliers:
    "Claude Opus 4.6":  1.00
    "Claude Sonnet 4":  1.00
    "Claude Haiku 4.5": 0.33
    "GPT-5.4":          1.00
    "GPT-5.4-mini":     0.33

notes:
  - "These numbers are placeholders. Update them from your provider's pricing page."
  - "If a model used is not listed, the reporter records tokens but marks cost 'n/a'."
  - "Cost is only computed when the orchestrator is run with allow_cost=true."
```
