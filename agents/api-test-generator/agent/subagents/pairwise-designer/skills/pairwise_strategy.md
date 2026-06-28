---
description: PICT model structure, three-layer coverage, strength decisions, constraint importance, and what the IPOG tool needs.
---

# Skill: Pairwise Strategy (Pairwise Designer copy)

## The PICT model — three elements

Every set of factors you produce for an endpoint IS a PICT model:
1. **Parameters (factors)** — what to vary.
2. **Values (levels)** — distinct values per parameter.
3. **Constraints** — infeasible or always-deterministic combinations.

> **The constraint block is the most valuable part most teams skip.**
> Write at least one constraint per endpoint. Constraints encode domain
> knowledge, prevent impossible test combinations, and surface assumptions
> that would otherwise be lost as the team changes.

The IPOG tool turns your factor definitions into a minimum covering matrix.
You define factors + constraints only — never compute combinations yourself.

## Three-layer coverage

Match endpoints to the right coverage layer:

| Layer | What it covers | Key factors to include |
|---|---|---|
| **1 — Capability** | Core CRUD + data variations | `role`, `resource_state`, enum/boolean params, boundary numerics |
| **2 — Connectivity** | Auth + connection patterns | `auth_type`, `connection_mode` (only when behavior differs per mode) |
| **3 — Environment** | Module × deployment | `env_type`, `module` (only when endpoint behavior differs per env) |

Most endpoints belong to Layer 1. Always add `role` to every endpoint.
Add Layer 2 and 3 factors only when the spec documents different behavior
per connection mode or deployment type.

## When to use each strength

| Strength | When | Typical row count |
|---|---|---|
| 1 — singletons | Sanity sweep only; very few factors | 1 row per level |
| 2 — pairwise | Default | 4–25 rows per endpoint |
| 3 — triples | High-risk: auth, payment, lineage | More rows; justified for the risk |

Default to **2**. Promote to 3 when:
- The endpoint grants or revokes permissions.
- Incorrect behavior causes financial or data integrity loss.
- Past bug history shows three-way interactions found defects.

## Why you do NOT compute combinations

The IPOG algorithm is deterministic code in the `generate_pairwise_matrix` tool.
Your job is to identify the factors, levels, and constraints **correctly** — the
tool handles the combinatorial math precisely and reproducibly. Attempting to
enumerate combinations yourself would waste tokens and introduce errors.

## How constraints reduce rows

When you define:
```jsonc
{ "if": { "role": "anonymous" }, "expect_status": 401 }
```
The IPOG tool generates rows where `role=anonymous`, assigns them status 401,
and does **not** pair `role=anonymous` with other factors for coverage purposes
(because the result is always 401 regardless). This reduces the total row count
while keeping RBAC-negative test cases.

When you define:
```jsonc
{ "if": { "field_a": "value_x" }, "skip": { "field_b": "value_y" } }
```
The IPOG tool skips any row combining `field_a=value_x` with `field_b=value_y`,
marking that pair as infeasible in the coverage report.

## What the IPOG tool consumes

The IPOG tool reads your output as:
```jsonc
{
  "endpoints": {
    "<operationId>": {
      "path": "/pets",          // include — used for .pict file header
      "method": "GET",          // include — used for .pict file header
      "strength": 2,
      "factors": [ { "name": "<string>", "levels": ["<string>", ...] } ],
      "constraints": [ ... ],
      "must_include": [ { "<factor>": "<level>", ... } ]
    }
  }
}
```

All level values must be **strings**. The tool does not coerce types.
Include `path` and `method` from the endpoint model so the tool can generate
accurate `.pict` file headers for version-controlled auditability.

## Coverage target

The goal is **100% of feasible pairs** (pairs not excluded by constraints).
A pair that is excluded by a constraint is reported as infeasible, not as a
gap — so coverage can reach 100% even with constraints.

## Economy rules

- ≤ 6 levels per factor. If a factor has more naturally, group them (e.g.,
  group multiple valid sort fields as "valid_field" and one invalid as "invalid").
- ≤ 8 factors per endpoint. If an endpoint has more, prioritize: security >
  required params > optional params > body fields.
- Strength 3 is only justified when you can name a specific three-way interaction
  that would be missed by pairwise.
