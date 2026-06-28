---
description: PICT model structure, three-layer coverage, strength decisions, IPOG algorithm overview, and coverage reporting.
---

# Skill: Pairwise Test Strategy

Load this skill when deciding factor definitions to pass to
`generate_pairwise_matrix`, or when interpreting the matrix output.

---

## The PICT model — core concept

Pairwise Independent Combinatorial Testing (PICT) generates a **minimal test
matrix where every pair of parameter values appears together at least once**.
The key insight: the vast majority of software defects are triggered by the
interaction of just two parameters, not the full set.

**Typical reduction:**
- Full Cartesian: 1,400 scenarios
- Feasible pairs to cover: ~231
- Single test covers C(4,2) = 6 pairs
- PICT achieves: 35–45 rows — **~97% reduction**

The three elements of every PICT model:
1. **Parameters** — the factors to vary (role, limit, auth_type, …)
2. **Values** — the levels per parameter (admin|viewer|anonymous, 1|50|100|101)
3. **Constraints** — infeasible combinations (`IF role="anonymous" THEN expect 401`)

> The constraint block is the most valuable part most teams skip.
> Constraints codify discovered gaps and prevent knowledge loss as the team
> grows or rotates. Store the PICT model file version-controlled next to the
> spec so CI can regenerate the matrix on model changes.

---

## PICT model file format (generated as `<operationId>.pict`)

```
# PICT Model — listPets (GET /pets)
# Strength: 2 (pairwise)
# Generated: 2026-06-28T10:00:00Z

role:  admin, viewer, anonymous
limit: null, 1, 50, 100, 101
sort:  name, invalid_field

IF [role] = "anonymous" THEN [limit] = "10";
IF [limit] = "101" THEN [role] = "admin";
```

The `generate_pairwise_matrix` tool emits one `.pict` file per endpoint under
`pict_models/<operationId>.pict`. These files are auditable, version-controlled,
and can be re-processed by the PICT CLI if available.

---

## Three-layer coverage model (from your article)

For complex APIs with multiple dimensions, structure factor analysis in three
layers. The Pairwise Designer should identify which layer each endpoint belongs
to and design factors accordingly:

### Layer 1 — Capability × Data Source Coverage

Tests each capability (list, create, update, delete) against relevant data source
types where applicable. Factors: `operation_type`, `source_type`, `data_format`.

### Layer 2 — Connectivity Matrix

Tests authentication and connection patterns. Factors: `auth_type`
(basic|bearer|apikey|none), `connection_mode` (direct|proxy|federated),
`deployment` (on-prem|cloud|k8s).

### Layer 3 — Module × Environment Interactions

Tests product modules across source-environment pairs. Factors: `module`
(discovery|quality|catalog|governance), `env_type` (dev|staging|prod).

For most API endpoints only Layer 1 (capability) applies. Assign Layer 2 and 3
only to endpoints that actually vary behavior by connection mode or deployment.

---

## When to use each strength

| Strength | When | Typical row count |
|---|---|---|
| 1 — singletons | Sanity / smoke only; ≤ 2 factors | N (one per level) |
| 2 — pairwise | **Default** for most endpoints | 4–25 rows |
| 3 — triples | High-risk: auth decisions, financial ops, data lineage | More rows; justified |

Default to **strength 2**. Promote to 3 when the endpoint touches:
- Authentication / authorization grants or revocations.
- Financial transactions or resource ownership changes.
- Data lineage or immutable record creation where three-way interactions hide defects.

---

## Factors worth including

| Parameter type | Levels | Notes |
|---|---|---|
| Boolean | `["true", "false"]` | Always both |
| Enum (≤ 8 values) | All declared values | |
| Enum (> 8 values) | First, last, one boundary, one invalid | Reduce to ≤ 8 |
| Integer with min/max | `["null", "<min>", "<typical>", "<max-1>", "<max>", "<max+1>"]` | null = omit if optional |
| String with maxLength | `["", "short", "<max-1 chars>", "<max chars>", "<max+1 chars>"]` | |
| Auth role | `["admin", "viewer", "anonymous"]` | Adapt to actual roles in spec |

**Skip** a factor when: the parameter is purely internal metadata, deprecated
and server-ignored, or changing its value never produces a different observable
HTTP status or body structure.

---

## Constraint patterns

```jsonc
{ "if": { "role": "anonymous" }, "expect_status": 401 }
```
→ Any row with `role=anonymous` is an RBAC `-ve` iteration expecting 401.
The IPOG tool still generates these rows (they are must-include patterns)
but marks them with the expected status.

```jsonc
{ "if": { "has_parent": "false" }, "skip": { "parent_id": "valid_uuid" } }
```
→ Structurally invalid combination — prune from matrix and mark infeasible.

```jsonc
{ "if": { "limit": "101" }, "expect_status": 400 }
```
→ Over-boundary value always returns validation error. Generate the row but
mark as `Boundary` / `Negative` type.

---

## Must-include rows (minimum contract)

Every endpoint must have:
- ≥ 1 **Smoke** row: all valid values, authorized role, typical params.
- ≥ 1 **RBAC -ve** row per unauthorized role variant.

High-risk endpoints (auth, money, lineage) also need:
- ≥ 1 **Boundary** row at `max` value.
- ≥ 1 **Boundary** row at `max+1` (over-boundary → expect 400/422).

---

## Coverage report interpretation

```jsonc
{
  "operationId": "listPets",
  "factors": 3,
  "total_possible_pairs": 12,
  "feasible_pairs": 10,
  "covered_pairs": 10,
  "pair_coverage_pct": 100,
  "generated_rows": 6,
  "must_include_rows": 2,
  "ipog_rows": 4,
  "pruned_by_constraints": 2
}
```

`pair_coverage_pct = 100` means 100% of **feasible** pairs are covered.
Pairs excluded by constraints are reported as infeasible — not as gaps.

---

## What the IPOG tool does

`generate_pairwise_matrix` implements IPOG at the specified strength:
1. Seeds with all combinations of the first `strength` factors.
2. Extends coverage one factor at a time — greedily selects the level covering
   the most uncovered pairs.
3. Applies constraints to prune infeasible rows and mark expected statuses.
4. Force-includes all `must_include` rows first.
5. Emits `.pict` model files for auditability.

Do **not** ask the Pairwise Designer to compute combinations. Return factor
definitions only — the IPOG tool handles the math deterministically.
