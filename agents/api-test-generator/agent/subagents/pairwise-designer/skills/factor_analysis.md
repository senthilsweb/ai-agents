---
description: How to extract testable factors from an OpenAPI endpoint definition for pairwise test design using the PICT model structure.
---

# Skill: Factor Analysis

Load this skill before analyzing each endpoint in the model.

## PICT model structure — three elements

Every factor analysis produces a PICT model with three elements:
1. **Parameters (factors)** — what to vary.
2. **Values (levels)** — the distinct values to exercise per factor.
3. **Constraints** — infeasible or always-rejected combinations.

> **The constraint block is the most valuable part most teams skip.**
> Constraints encode your domain knowledge about impossible or deterministic
> combinations. They prevent generating tests that can never pass and they
> surface assumptions that would otherwise be lost as the team changes.
> Always write a constraint block — even if it has just one rule.

The IPOG tool turns this structure into a minimum covering matrix. You only
define factors and constraints. Never compute combinations yourself.

## Three-layer coverage model

Identify which layer each endpoint belongs to and design factors accordingly:

| Layer | What it tests | Typical factors |
|---|---|---|
| 1 — Capability × Data | Core CRUD behavior + data variations | `operation_type`, `resource_state`, `data_format` |
| 2 — Connectivity | Auth + connection mode | `role`, `auth_type`, `connection_mode` |
| 3 — Environment | Module × environment | `module`, `env_type` |

**Most endpoints belong to Layer 1.** Add Layer 2 factors (`role`) to every
endpoint. Add Layer 3 factors only when the endpoint behavior actually changes
per deployment type (on-prem vs cloud vs k8s).

## What makes a good factor

A factor is a parameter (or combination property) whose value meaningfully changes
the observable behavior of the endpoint. "Observable behavior" means:

- A different HTTP status code.
- A different response body structure.
- A different set of returned records.
- A different side effect (record created/not created).

A factor with only one effective level adds no discriminating power — skip it.

## Factor identification by parameter type

### Query/path parameters

| Schema type | Factor? | Levels |
|---|---|---|
| boolean | Always | `["true", "false"]` |
| integer (no min/max) | Include only if value changes behavior | `["0", "1", "negative"]` |
| integer (with min/max) | Yes | see boundary levels table |
| string (enum) | Yes | all declared enum values |
| string (pattern) | Sometimes | valid + boundary + invalid examples |
| string (format: uuid) | Skip (opaque) | — |
| array | Include if size matters | `["empty", "single", "multi"]` |

### Boundary levels for numeric parameters

Given `minimum: M` and `maximum: N`:
```
levels: ["<M-1_or_null>", "<M>", "<typical>", "<N-1>", "<N>", "<N+1>"]
```

For a required parameter, replace `null` with the minimum value.
For an optional parameter, include `null` to represent the omitted case.

"Typical" is the midpoint, or the value shown in the OpenAPI example if one exists.

### Request body fields

Include body fields as factors when:
- A field is an enum — each value is a level.
- A field is boolean — both values are levels.
- The spec has `minimum`/`maximum` or `minLength`/`maxLength` — use boundary levels.
- A field is nullable — include both `null` and a valid value.

Do not factor every field in a large body — pick the fields most likely to
produce different behavior (typically: required fields, nullable fields, enum
fields, fields mentioned in acceptance criteria).

### Auth / role factors

When the spec defines multiple security schemes or scopes:
- Add a `role` factor with one level per distinct access level.
- Include `anonymous` (no credentials) if the endpoint is not marked as
  requiring auth for all roles.
- Use the role names from the spec's security schemes or, if absent, derive
  from the spec's description (look for terms like "admin", "viewer", "owner").

## Constraint patterns

### Always-rejected role
```jsonc
{ "if": { "role": "anonymous" }, "expect_status": 401 }
```
The IPOG tool will still create rows for `anonymous` but marks them with the
expected status — useful for RBAC `-ve` iterations.

### Structurally dependent fields
```jsonc
{ "if": { "has_parent": "false" }, "skip": { "parent_id": "valid_uuid" } }
```
When `has_parent=false`, any value of `parent_id` is ignored by the server —
this combination is infeasible.

### Enum that always short-circuits
```jsonc
{ "if": { "status": "archived" }, "expect_status": 404 }
```
When status=archived, the server returns 404 regardless of other parameters —
no need to generate pairs involving `status=archived` and other factor values.

## Decision tree: include or skip?

```
Is the parameter required and has only one valid value?
  → Skip (single level — no discriminating power)

Does the parameter affect authorization (role, scope, permission)?
  → Include with role levels

Does the parameter select a resource (path id like {petId})?
  → Include with: valid_existing, valid_nonexistent, invalid_format

Does the parameter filter/paginate a collection (limit, offset, sort)?
  → Include limit/sort only if the spec documents behavior changes.
    - limit: boundary levels
    - sort: valid_field, invalid_field
    - offset: 0, 1, beyond_end

Does the parameter change the response body structure?
  → Include

Otherwise?
  → Skip or include as a one-level note in `must_include` only.
```

## Output for each endpoint

Include optional `path` and `method` metadata so the IPOG tool can generate
an accurate `.pict` file header:

```jsonc
{
  "path": "/pets",
  "method": "GET",
  "strength": 2,
  "factors": [
    { "name": "role",  "levels": ["admin", "viewer", "anonymous"] },
    { "name": "limit", "levels": ["null", "1", "50", "99", "100", "101"] },
    { "name": "sort",  "levels": ["name", "invalid_field"] }
  ],
  "constraints": [
    { "if": { "role": "anonymous" }, "expect_status": 401 },
    { "if": { "limit": "101" }, "expect_status": 400 }
  ],
  "must_include": [
    { "role": "admin", "limit": "10", "sort": "name" },
    { "role": "anonymous", "limit": "10", "sort": "name" }
  ]
}
```

**Constraint block checklist:**
- [ ] Every unauthorized role covered (→ expect 401/403).
- [ ] Every over-boundary value covered (→ expect 400/422).
- [ ] Every structurally dependent field pair covered (→ skip or expect error).
- [ ] At least one constraint per endpoint — never leave this empty.
