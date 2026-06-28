---
description: Postman v2.1.0 collection schema, data file contract, config separation, and what assemble_collection produces.
---

# Skill: Collection Assembly

Load this skill before calling `assemble_collection` or when reviewing
generated artifacts.

## Separation of concerns (non-negotiable)

| Artifact | What it contains | Who edits it |
|---|---|---|
| `*_collection.json` | Requests + test scripts (pm.test blocks) | Agent generates once; human only edits to fix a script bug |
| `*_data.json` | Iteration rows (test data) | **Freely extensible** — add rows, remove rows, change values without touching the collection |
| `*_environment.json` | Postman env vars with defaults | Humans update per environment |
| `api_config.json` | Base URL, auth profile, timeouts | Human/CI updates per deployment target |
| `collection_data.yml` | Central manifest mapping category → collection → data | Agent generates; human extends with new categories |
| `test_scripts/` | One `.js` file per request (scripts extracted for review) | Read-only reference; re-incorporate if edited |

**The test scripts never encode expected values directly.** Every expected status,
body substring, and content-type is in the data file, read via
`pm.iterationData.get(...)`. This is what makes the data file independently
extensible.

---

## Test case classification (mandatory)

Every iteration row in the data file must carry these classification keys:

```jsonc
{
  "TSName": "List pets as admin WITH limit=10 · expect 200 + array",
  "product": "PDC",                   // MANDATORY — product family
  "feature": "resources",             // MANDATORY — feature group (kebab-case)
  "capability": "list-pets",          // MANDATORY — specific action (kebab-case)
  "domain": "data-governance",        // OPTIONAL  — business domain
  "_validation_type": "Functional",
  ...
}
```

Classification rules:
- `product`: short product name, e.g. `PDC`, `PBA`, `PDE`. From `api_name` prefix or user option.
- `feature`: OpenAPI tag in kebab-case, e.g. `pets`, `users-and-communities`.
- `capability`: `<method>-<resource>` in kebab-case, e.g. `list-pets`, `create-pet`.
- `domain`: optional free-text business domain for reporting/filtering.

---

## `api_config.json` (separate runtime config)

Generated alongside the collection — never embedded inside it:

```jsonc
{
  "api_name": "PetStore",
  "collection_file": "PetStore_collection.json",
  "data_file": "PetStore_data.json",
  "environment_file": "PetStore_environment.json",
  "base_url_var": "{{base_url}}",
  "auth": {
    "type": "basic",
    "username_var": "username",
    "password_var": "password"
  },
  "environment_name": "PetStore Local",
  "defaults": {
    "timeout_ms": 30000,
    "insecure": true,
    "bail_on_failure": false
  },
  "endpoints": [
    {
      "operationId": "listPets",
      "method": "GET",
      "path": "/pets",
      "request_name": "List Pets",
      "product": "PDC",
      "feature": "pets",
      "capability": "list-pets"
    }
  ]
}
```

CI and tooling read `api_config.json` to learn how to run Newman without
opening the Postman files. The Postman environment JSON is for Postman's own
variable resolution; `api_config.json` is for the test harness.

---

## `collection_data.yml` (manifest registry)

Central manifest matching the existing framework's `collection_data.yml` pattern.
Each category maps to one or more collection+data pairs:

```yaml
Pets:
  - collectionName: PetStore_collection.json
    description: API tests for the Pets resource
    testDataName: PetStore_data.json
    product: PDC
    feature: pets
    capability: list-pets
    testCases:
      - testCaseName: "List pets as admin WITH limit=10 · expect 200 + array"
        requests:
          - List Pets
      - testCaseName: "List pets as anonymous · expect 401"
        requests:
          - List Pets
```

The `testCases` block reflects the pairwise matrix rows and enables downstream
test management tools (PractiTest, GitHub test management) to auto-register
test cases without reading the data file directly.

---

## Postman v2.1.0 collection skeleton

```jsonc
{
  "info": {
    "_postman_id": "<uuid>",
    "name": "<ApiName>_collection",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "auth": { "type": "basic", "basic": [
    { "key": "username", "value": "{{username}}", "type": "string" },
    { "key": "password", "value": "{{password}}", "type": "string" }
  ]},
  "item": [
    {
      "name": "<Tag Folder>",
      "item": [
        {
          "name": "<Request Name>",
          "request": {
            "method": "GET",
            "header": [],
            "url": { "raw": "{{base_url}}/pets", "host": ["{{base_url}}"], "path": ["pets"] }
          },
          "event": [
            { "listen": "test", "script": { "type": "text/javascript", "exec": ["<assertion script>"] } }
          ]
        }
      ]
    }
  ]
}
```

**No credentials in collection JSON.** Auth values always come from
environment variables or iteration data — never hardcoded.

---

## Data file contract

JSON array — each element is one Newman iteration:

```jsonc
[
  {
    "TSName": "List pets as admin WITH limit=10 · expect 200 + array",
    "product": "PDC",
    "feature": "pets",
    "capability": "list-pets",
    "_validation_type": "Smoke",
    "_comments": "Happy path — admin with valid pagination",
    "username": "{{ENV_USERNAME}}",
    "password": "{{ENV_PASSWORD}}",
    "limit": "10",
    "responseCodeForListPets": 200,
    "responseTextForListPets": "id",
    "contentTypeForListPets": "application/json"
  },
  {
    "TSName": "List pets as anonymous · expect 401",
    "product": "PDC",
    "feature": "pets",
    "capability": "list-pets",
    "_validation_type": "RBAC -ve",
    "_comments": "Anonymous user should be rejected",
    "username": "",
    "password": "",
    "limit": "10",
    "responseCodeForListPets": 401,
    "responseTextForListPets": "Unauthorized",
    "contentTypeForListPets": "text/html"
  }
]
```

**To extend test data:** add a new JSON object to the array. No collection file
change needed. Keys must be present in every row for the assertions to run.

Required keys per iteration:
- Classification: `product`, `feature`, `capability` (+ optional `domain`).
- `TSName` — unique, human-readable.
- `_validation_type` — one of: `RBAC +ve` · `RBAC -ve` · `Functional` · `Negative` · `Boundary` · `Smoke`.
- `_comments` — short rationale.
- Credentials: `username`/`password`, `bearer_token`, or `api_key`.
- For every request `<R>`: `responseCodeFor<R>`, `responseTextFor<R>`, `contentTypeFor<R>`.

---

## `test_scripts/` (extracted scripts for review)

Each request's assertion script is also written to `test_scripts/<RequestName>.js`
so humans can review scripts in isolation without navigating the collection JSON.
These files are read-only reference — they do not drive execution.

```
test_scripts/
  List Pets.js
  Create Pet.js
  Get Pet.js
```

---

## What assemble_collection produces

```
<run_dir>/
  PetStore_collection.json      ← collection with embedded test scripts
  PetStore_environment.json     ← Postman environment
  PetStore_data.json            ← Newman iteration data (freely extensible)
  api_config.json               ← runtime config (base URL, auth, endpoints)
  collection_data.yml           ← manifest registry
  test_scripts/
    List Pets.js
    Create Pet.js
```
