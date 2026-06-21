---
description: Token cost rate-card for the LinkedIn Cover Reporter. Load when computing token cost in a report (only with allow_cost=true).
---

# Token Cost Rate-Card

These values are the cost-rates used by the reporter. Rates are per 1M tokens
(USD). Verify against your provider's pricing page before trusting any cost
figure.

```yaml
version: 2
currency: USD
mode: per_token            # per_token | per_request

# ---- per_token mode: USD per 1,000,000 tokens, matched by the model name a phase used ----
per_token:
  default:             { input: 0.00, output: 0.00 }   # fallback -> phase cost marked n/a

  # z.ai (GLM) — https://z.ai/pricing
  "glm-5.2":           { input: 1.40,  output: 4.40 }   # reasoning, 1M context
  "glm-5.1":           { input: 1.40,  output: 4.40 }
  "glm-5":             { input: 1.40,  output: 4.40 }
  "glm-5-turbo":       { input: 0.70,  output: 2.20 }
  "glm-4.7":           { input: 0.60,  output: 2.20 }
  "glm-4.6":           { input: 0.60,  output: 2.20 }
  "glm-4.5":           { input: 0.60,  output: 2.20 }
  "glm-4.5-air":       { input: 0.20,  output: 1.10 }   # fast, non-reasoning, 128K context
  "glm-4-plus":        { input: 0.50,  output: 1.50 }

  # OpenAI
  "gpt-4o":            { input: 2.50,  output: 10.00 }
  "gpt-4o-mini":       { input: 0.15,  output: 0.60 }
  "gpt-5.4":           { input: 1.25,  output: 10.00 }
  "gpt-5.4-mini":      { input: 0.25,  output: 2.00 }
  "gpt-5.4-nano":      { input: 0.10,  output: 0.40 }
  "gpt-image-2":       { input: 0.00,  output: 0.00 }   # image model — cost is per-image, not per-token

  # DeepSeek
  "deepseek-v4-pro":   { input: 0.27,  output: 1.10 }

  # Anthropic (via gateway / direct)
  "anthropic/claude-sonnet-4.6": { input: 3.00, output: 15.00 }
  "anthropic/claude-opus-4.6":   { input: 5.00, output: 25.00 }
  "anthropic/claude-haiku-4.5":  { input: 0.80, output: 4.00 }

# ---- per_request mode (e.g. Copilot premium requests / credits) ----
per_request:
  usd_per_premium_request: 0.04
  multipliers:
    "glm-5.2":          1.00
    "glm-4.5-air":      0.33
    "gpt-5.4-mini":     0.50
    "gpt-5.4-nano":     0.25

notes:
  - "Rates are estimates from the provider's pricing page; verify before relying on cost figures."
  - "z.ai GLM rates: https://z.ai/pricing (GLM-5.2 $1.40/$4.40, GLM-4.5-Air $0.20/$1.10 per 1M tokens)"
  - "OpenAI rates: https://openai.com/pricing (gpt-5.4-mini $0.25/$2.00, gpt-5.4-nano $0.10/$0.40 per 1M tokens)"
  - "If a model used is not listed, the reporter records tokens but marks cost 'n/a'."
  - "Cost is only computed when the orchestrator is run with allow_cost=true."
  - "Image generation cost (gpt-image-2) is per-image, not per-token — not included in token cost."
  - "Cache read tokens are typically billed at a discount (e.g. 10% of input); adjust if your provider differs."
```
