---
description: Naming conventions for collections, folders, request names, data files, TSNames, classification taxonomy, and variable placeholders.
---

# Skill: Naming Rules

Load this skill before calling `apply_naming_rules` or when reviewing the
generated collection for naming compliance.

---

## Test case classification taxonomy

Every test case must carry these fields (derived from OpenAPI metadata and user options):

| Field | Required | Source | Format | Example |
|---|---|---|---|---|
| `product` | **Yes** | `api_name` prefix or `--product` option | Short uppercase identifier | `PDC` |
| `feature` | **Yes** | OpenAPI tag (first) | kebab-case | `pets`, `users-and-communities` |
| `capability` | **Yes** | `<method>-<resource>` | kebab-case | `list-pets`, `create-pet` |
| `domain` | No | User option `--domain` | kebab-case | `data-governance`, `catalog` |

**Capability derivation:**
- `GET /pets` → `list-pets`
- `POST /pets` → `create-pet`
- `GET /pets/{id}` → `get-pet`
- `PUT /pets/{id}` → `update-pet`
- `DELETE /pets/{id}` → `delete-pet`

These four fields appear in every iteration row in the data file and in the
`collection_data.yml` manifest. They enable filtering by product/feature/
capability in reporting without reading the full collection.

---

## File names

| Artifact | Rule | Example |
|---|---|---|
| Collection file | `<ApiName>_collection.json` — suffix mandatory | `PetStore_collection.json` |
| Data file | `<ApiName>_data.json` — suffix mandatory | `PetStore_data.json` |
| Environment file | `<ApiName>_environment.json` | `PetStore_environment.json` |
| Config file | `api_config.json` — fixed name | `api_config.json` |
| Manifest | `collection_data.yml` — fixed name | `collection_data.yml` |
| Script files | `test_scripts/<RequestName>.js` | `test_scripts/List Pets.js` |

`ApiName` is the `api_name` option verbatim (preserve case).

---

## Postman folder names

Folders map to OpenAPI tags. Transformation:
- Convert `kebab-case` / `snake_case` → `Title Case With Spaces`.
- `pets` → `Pets`, `user-auth` → `User Auth`, `resources_aws` → `Resources Aws`.
- Maximum 40 characters; truncate with `…` suffix.

---

## Request names

Derived from `operationId` → split on camelCase → Title Case:
- `listPets` → `List Pets`
- `createPet` → `Create Pet`
- `getPetById` → `Get Pet By Id`

Fallback (no operationId): `<TitleCaseVerb> <TitleCasedResourceNoun>`:
- `GET /pets` → `List Pets`
- `POST /pets` → `Create Pet`
- `GET /pets/{id}` → `Get Pet`

Verb mapping: `GET` (collection path) → `List`, `GET` (id in path) → `Get`,
`POST` → `Create`, `PUT/PATCH` → `Update`, `DELETE` → `Delete`.

---

## `info.name` inside collection

Exact file name minus `.json`:
- `PetStore_collection.json` → `PetStore_collection`

---

## TSName (iteration label field)

Format:
```
<Verb> <resource> [WITH|WITHOUT|USING <key variant>] [· <variable=value>] · expect <observable outcome>
```

Rules:
- **Unique within the data file.**
- Encodes **scenario + expected outcome** — a reader must understand the test from the name alone.
- Verb: imperative present tense (`Create`, `List`, `Get`, `Delete`, `Update`).
- Outcome must cite an observable: HTTP status · key in response body · header.
- RBAC variants: `as <role>` (e.g., `as admin`, `as viewer`, `as anonymous`).
- Parameter variants: `WITH <name>=<value>`.
- `domain` classified separately — do not encode domain in TSName.
- **Max 120 characters.**

Examples:
```
List pets as admin WITH limit=10 · expect 200 + array
List pets as anonymous · expect 401
Create pet WITH tag=null · expect 201 + id returned
Create pet WITH duplicate name · expect 409
Get pet WITH id=nonexistent · expect 404
```

**Forbidden patterns:**
- Bare verbs: ~~"Test list pets"~~, ~~"Verify create"~~
- Vague outcomes: ~~"should work"~~, ~~"no errors"~~, ~~"200 OK"~~ (specify body evidence)
- Credentials in name: ~~"admin user creates pet"~~ (use `as admin`)

---

## Assertion key suffix

Derived from request name: strip spaces, capitalize first letter of each word, join.

| Request name | Suffix | Keys generated |
|---|---|---|
| `List Pets` | `ListPets` | `responseCodeForListPets`, `responseTextForListPets`, `contentTypeForListPets` |
| `Create Pet` | `CreatePet` | `responseCodeForCreatePet`, `responseTextForCreatePet`, `contentTypeForCreatePet` |
| `Get Pet By Id` | `GetPetById` | `responseCodeForGetPetById`, … |

Keys must be **identical across all iterations** — the Newman runner joins
assertions by exact key name. A missing key means the assertion silently skips.

---

## Variable hygiene

- Base URL: `{{base_url}}` (or `{{base_url_<service>}}` for multi-service).
- Credentials: `{{username}}`, `{{password}}` (basic); `{{bearer_token}}` (bearer); `{{api_key}}` (apikey).
- **Never** hard-code hostnames, ports, file paths, or credentials in collection scripts or data values.
- Data file credential values use `{{ENV_USERNAME}}` style refs when they should come from `.env` — the Postman environment resolves them.
- Dynamic IDs captured during test execution use collection variables: `pm.collectionVariables.set("petId", ...)`.

---

## `_validation_type` values

Exactly one of:

| Value | When |
|---|---|
| `Smoke` | First happy-path row per endpoint; run in every CI pipeline |
| `RBAC +ve` | Authorized role exercising the capability |
| `RBAC -ve` | Unauthorized/anonymous role — expect 401/403 |
| `Functional` | Normal-path variations |
| `Negative` | Invalid input, missing required fields |
| `Boundary` | At-min, at-max, below-min, above-max values |
