---
description: TSName format and assertion key suffix derivation for the Assertion Writer.
---

# Skill: Naming Rules (Assertion Writer copy)

## TSName format

```
<Verb> <resource> [WITH|WITHOUT|USING <key variant>] [· <variable=value>] · expect <observable outcome>
```

### Required tokens

| Token | Examples |
|---|---|
| verb | `List` · `Create` · `Get` · `Update` · `Delete` |
| resource | `pet` · `user` · `order` · `token` |
| variant | `WITH tag=dog` · `as admin` · `WITHOUT auth` |
| outcome | `200 + array` · `201 + id returned` · `401` · `400 + validation error` |

### Examples by validation type

| Type | TSName |
|---|---|
| Smoke | `List pets as admin WITH limit=10 · expect 200 + array` |
| RBAC +ve | `Create pet as editor · expect 201 + id returned` |
| RBAC -ve | `List pets as anonymous · expect 401` |
| Boundary | `Create pet WITH name at max length · expect 201` |
| Boundary | `Create pet WITH name over max length · expect 400 + validation error` |
| Negative | `Get pet WITH id=nonexistent · expect 404` |
| Functional | `Update pet WITH tag=null · expect 200 + tag removed` |

### Rules

- Outcome after `· expect` is mandatory — forbidden: "should work", "no errors".
- HTTP status always present in outcome.
- Use `as <role>` for RBAC variants, `WITH <param>=<value>` for value variants.
- ≤ 120 characters total.
- Unique within the data file — if collision, append `(2)`.

## Test case classification (context — not yours to set)

Every iteration row in the data file will have these classification fields
set by the orchestrator (`assemble_collection` tool):

| Field | Set by | In your TSName? |
|---|---|---|
| `product` | orchestrator (user option) | No — classification, not scenario |
| `feature` | orchestrator (OpenAPI tag) | No |
| `capability` | orchestrator (method+path) | No |
| `domain` | orchestrator (user option) | No |

Your job is `tsname_suggestions` only — do not set or reference these fields.

## Assertion key suffix

Suffix = strip whitespace from request name, capitalize each word, join:

- `"List Pets"` → `ListPets`
- `"Create Pet"` → `CreatePet`
- `"Get Pet"` → `GetPet`
- `"Delete Pet"` → `DeletePet`

This suffix is used in ALL three iteration data keys:
- `responseCodeFor<Suffix>` → integer HTTP status
- `responseTextFor<Suffix>` → expected substring in body (or null)
- `contentTypeFor<Suffix>` → expected Content-Type base (or null)
