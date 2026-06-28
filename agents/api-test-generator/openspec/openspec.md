# OpenSpec: API Test Generator — OpenAPI → Business-Verified Postman/Newman Suite

**Status:** Implemented  
**Agent path:** `agents/api-test-generator/`  
**Version:** 2.0.0

---

## 1. Problem

Off-the-shelf OpenAPI test generators produce mechanical tests that verify HTTP
codes but ignore business semantics. They miss filter correctness, response echo
checks, required field validation, and resource lifecycle. They have no naming
standard, no combinatorial strategy, and no analytics. The result: low-confidence
test suites that drift from the spec and cannot tell you whether the API actually
behaves correctly.

---

## 2. Goals

- **Business functionality first.** Derive test scenarios from spec semantics —
  parameter descriptions, response schemas, endpoint summaries — not from generic
  test type categories.
- **Deterministic wherever possible.** Parsing, naming, IPOG combination math,
  collection assembly, and reporting never touch a model.
- **LLM only where reasoning adds value.** Factor analysis (extracting business
  rules from spec content), assertion script authoring (encoding those rules as
  `pm.test()` blocks), and test name generation.
- **Two strictly separated phases.** Authoring (LLM-involved, once) and execution
  (deterministic, CI/CD, no LLM).
- **Test data from real sources.** Resource IDs (patientId, encounterId, orgId)
  resolved from JDBC or Object Store at execution time — not hardcoded.
- **Analytics in the data lake.** Structured JSONL published to S3/MinIO with
  Hive partitioning — DuckDB-queryable without ETL.
- **Right-sized models.** Opus 4.8 for complex factor reasoning (once), Haiku 4.5
  for bulk assertion generation, Sonnet 4.6 for coordination.

---

## 3. Non-goals

- UI automation, fuzzing, security scanning, load testing.
- Modifying the Newman/Postman runtime.
- Generating test data (fixture records) — data generators (Synthea, etc.) are
  separate; the agent only queries for existing IDs.

---

## 4. Two-Phase Architecture

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 1 — TEST AUTHORING  (Eve agent · LLM-involved · once)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

 OpenAPI spec
      │
      ▼ parse_openapi [deterministic]
      │ endpoint_model.json
      ▼ apply_naming_rules [deterministic]
      │ named_endpoint_model.json
      ▼ Pairwise Designer [claude-opus-4-8 · once]
      │ factors_model.json  (business factors + constraints)
      ▼ generate_pairwise_matrix [IPOG · deterministic]
      │ pairwise_matrix.json/.csv  +  pict_models/<opId>.pict
      ▼ Assertion Writer [claude-haiku-4-5 · bulk]
      │ assertion_scripts.json  (structural + business pm.test() blocks)
      ▼ assemble_collection [deterministic]
      │ *_collection.json   *_data.json   *_environment.json
      │ api_config.json     collection_data.yml   test_scripts/*.js
      ▼ validate_collection [deterministic · 8 gates]
      │ validation_report.md
      └─ COMMIT ARTIFACTS TO VCS ──────────────────────────────────┐

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━         │
PHASE 2 — TEST EXECUTION  (no LLM · CI/CD or on-demand)           │
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━         │
                                                                   │
 Artifacts from VCS ◄──────────────────────────────────────────────┘
      │
      ▼ setup_test_data [deterministic · optional]
      │ DuckDB queries JDBC / Object Store
      │ Injects real patientId, encounterId, orgId... into data_live.json
      ▼ run_newman [deterministic]
      │ newman_report.json
      ▼ assemble_report [deterministic]
      │ structured/test_results.jsonl  structured/coverage.json
      ▼ publish_results [deterministic]
      └─ S3/MinIO  year=YYYY/month=MM/day=DD/api_name=X/run_id=Y/
         DuckDB-queryable with hive_partitioning=true
```

Authoring re-runs only when the spec changes. Every CI/CD execution runs Phase 2
only — zero LLM tokens consumed per CI run.

---

## 5. Agent Roles

### 5.1 Orchestrator (`claude-sonnet-4-6`)

Coordination, run bookkeeping, sequential tool calls, final summary.
Does not perform combinatorial reasoning or bulk generation.
Cap: `ORCHESTRATOR_MAX_STEPS` (default 30).

### 5.2 Pairwise Designer subagent (`claude-opus-4-8`)

**Reads:** full `endpoint_model.json` — parameters, descriptions, response schemas,
examples, security definitions, enum lists.

**Produces:** `factors_model.json` — for each endpoint:
- Which parameters are testable factors (skips deprecated/internal)
- Factor levels: enum values, boundary numerics, role variants
- **Business constraints** derived from spec semantics:
  - "Filter by status" → IF status=available THEN response.items[].status === "available"
  - "Max items to return" → IF limit=N THEN response.length ≤ N
  - "Returns with assigned id" → POST 201 → response.id is a positive integer
- Must-include rows: smoke, RBAC+ve, RBAC-ve, lifecycle steps

Runs **once per authoring session**. Never computes combinations (that's IPOG).
Cap: `PAIRWISE_MAX_STEPS` (default 15).

### 5.3 Assertion Writer subagent (`claude-haiku-4-5-20251001`)

**Reads:** named endpoint model + sample matrix rows + auth profile.

**Produces:** `assertion_scripts.json` — per request:
- 3 mandatory structural blocks (status, Content-Type, body)
- N business assertion blocks derived from business constraints:
  - Filter correctness: `pm.expect(item.status).to.eql(expectedStatus)` for each item
  - Pagination: `pm.expect(jsonData).to.have.length.at.most(limit)`
  - Echo check: `pm.expect(response.name).to.eql(pm.iterationData.get("name"))`
  - Schema: `pm.expect(item.id).to.be.a("number").above(0)`
- TSName labels: `"List pets WITH status=available · expect 200 + only available items"`

All dynamic values read from `pm.iterationData.get(...)` — nothing hard-coded.
Cap: `ASSERTION_MAX_STEPS` (default 20).

---

## 6. Deterministic vs LLM Boundary

| Concern | Tool | LLM? |
|---|---|---|
| Parse OpenAPI 3.x + resolve `$ref` | `parse_openapi` | No |
| Naming rules (files, folders, request names) | `apply_naming_rules` | No |
| IPOG combination math + PICT file output | `generate_pairwise_matrix` | No |
| Collection assembly + 6 output artifacts | `assemble_collection` | No |
| Newman execution | `run_newman` | No |
| 8 validation gates | `validate_collection` | No |
| Structured analytics (JSONL) | `assemble_report` | No |
| S3/MinIO publish | `publish_results` | No |
| JDBC + Object Store data queries | `setup_test_data` | No |
| Factor identification + business constraints | Pairwise Designer (Opus) | **Yes** |
| pm.test() scripts + business assertions | Assertion Writer (Haiku) | **Yes** |
| TSName labels | Assertion Writer (Haiku) | **Yes** |

**95%+ of token budget is deterministic.** LLM is used only for judgment that
cannot be codified: business rule extraction and human-readable test names.

---

## 7. Tool Contracts

### `parse_openapi`

```typescript
input:  { spec_path: string }        // path in /workspace/inputs/ or URL
output: {
  endpoint_model_path: string        // run_dir/endpoint_model.json
  info: { title, version, description }
  endpoint_count: number
  schema_count: number
  warnings: string[]
}
```

Endpoint model row shape:
```jsonc
{
  "operationId": "listPets",
  "method": "GET",
  "path": "/pets",
  "tag": "pets",
  "summary": "List all pets",
  "description": "Filter results to only pets with this status",
  "parameters": [
    { "name": "status", "in": "query", "required": false,
      "description": "Filter results to only pets with this status",
      "schema": { "type": "string", "enum": ["available","pending","sold"] } }
  ],
  "responses": {
    "200": { "content_type": "application/json",
             "schema": { "type": "array", "items": { "required": ["id","name","status"] } } },
    "401": { "content_type": "text/html" }
  },
  "security": ["bearerAuth"]
}
```

### `apply_naming_rules`

```typescript
input:  { run_dir, endpoint_model_path, api_name, category? }
output: {
  named_model_path: string            // run_dir/named_endpoint_model.json
  collection_name: string             // "PetStore_collection.json"
  data_file_name: string              // "PetStore_data.json"
  folder_map: Record<string, string>  // tag → Postman folder name
}
```

### `generate_pairwise_matrix`

```typescript
input:  { run_dir, factors_model_path }
output: {
  matrix_path: string            // run_dir/pairwise_matrix.json
  csv_path: string               // run_dir/pairwise_matrix.csv
  pict_models_dir: string        // run_dir/pict_models/   (one .pict per endpoint)
  total_rows: number
  endpoints_covered: number
  pair_coverage_pct: number
}
```

`factors_model.json` produced by Pairwise Designer:
```jsonc
{
  "endpoints": {
    "listPets": {
      "path": "/pets",
      "method": "GET",
      "strength": 2,
      "factors": [
        { "name": "status", "levels": ["available","pending","sold","null"],
          "businessConstraint": "IF status is set AND 200 → all items.status === status value" },
        { "name": "limit", "levels": ["null","1","50","100","101"],
          "businessConstraint": "IF limit=N AND 200 → response.length ≤ N" },
        { "name": "role",  "levels": ["admin","viewer","anonymous"] }
      ],
      "constraints": [
        { "if": { "role": "anonymous" }, "expect_status": 401 },
        { "if": { "limit": "101" }, "expect_status": 400 }
      ],
      "must_include": [
        { "limit": "10", "role": "admin", "_label": "smoke" },
        { "status": "available", "role": "admin", "_label": "business-filter" },
        { "role": "anonymous", "_label": "rbac-negative" }
      ]
    }
  }
}
```

PICT file output (`pict_models/listPets.pict`):
```
# PICT Model — listPets (GET /pets)
# Strength: 2 (pairwise)
# Business constraints embedded — commit this file to VCS alongside the spec

status: available, pending, sold, null
limit: null, 1, 50, 100, 101
role: admin, viewer, anonymous

IF [role] = "anonymous" → expect HTTP 401
IF [limit] = "101" → expect HTTP 400
IF [status] <> "null" AND [role] <> "anonymous" → assert response.items[].status == status
```

### `assemble_collection`

```typescript
input:  {
  run_dir, api_name,
  product: string,          // mandatory classification: "PDC", "PBA"
  domain?: string,          // optional: "data-governance"
  auth_profile, base_url_var, environment_name, environment_vars
}
output: {
  collection_path: string         // *_collection.json
  environment_path: string        // *_environment.json
  data_files: string[]            // *_data.json
  api_config_path: string         // api_config.json — CI/CD runtime config
  collection_data_path: string    // collection_data.yml — manifest registry
  test_scripts_dir: string        // test_scripts/<RequestName>.js
  request_count: number
  iteration_count: number
}
```

**Six artifacts, strict separation of concerns:**

| File | Contains | When to edit |
|---|---|---|
| `*_collection.json` | Test scripts (HOW to assert) | Assertion logic changes only |
| `*_data.json` | Iteration rows (WHAT to test) | Add/remove scenarios freely |
| `*_environment.json` | Variable resolution (base URL, auth) | Per-environment setup |
| `api_config.json` | CI/CD runtime config | Base URL, auth profile, endpoint index |
| `collection_data.yml` | Manifest registry | Rarely — auto-generated |
| `test_scripts/*.js` | Extracted scripts | Read-only; for PR review |

**Every data row carries mandatory classification:**
```jsonc
{
  "product": "PDC",
  "feature": "pets",           // OpenAPI tag → kebab-case
  "capability": "list-pets",   // <method>-<resource> → kebab-case
  "domain": "catalog",         // optional
  "TSName": "List pets WITH status=available · expect 200 + only available items",
  "_validation_type": "Functional",
  "status": "available",
  "limit": "10",
  "role": "admin",
  "responseCodeForListPets": 200,
  "responseTextForListPets": "available",
  "contentTypeForListPets": "application/json",
  "expectFilterValue": "available",
  "expectMaxItems": "10"
}
```

No credentials in collection JSON — only `{{variable}}` placeholders.
`ENV_*`-prefixed env vars inject values at Newman runtime.

### `setup_test_data`

Execution-phase tool. Reads `test_data_config.json`, runs DuckDB queries against
JDBC or Object Store, and writes a patched data file with real resource IDs.

```typescript
input:  {
  run_dir: string
  data_path: string              // *_data.json — read-only source
  config_path: string            // test_data_config.json
  output_path?: string           // default: run_dir/data_live.json
}
output: {
  live_data_path: string         // run_dir/data_live.json — patched copy
  injected_keys: string[]        // which keys were resolved (patientId etc.)
  rows_patched: number
  datasource_results: Record<string, string[]>  // key → resolved values
}
```

DuckDB handles both source types:
- JDBC: `INSTALL jdbc; LOAD jdbc; ATTACH 'jdbc:postgresql://...' AS db (TYPE JDBC);`
- Object Store: `read_parquet('s3://bucket/path/*.parquet')` with S3 credentials

### `run_newman`

```typescript
input:  {
  run_dir: string
  collection_path: string
  environment_path?: string
  data_path?: string             // points to data_live.json if setup_test_data ran
  timeout_ms?: number            // default 30000
  bail?: boolean                 // default false
}
output: {
  exit_code: number
  passed: number
  failed: number
  duration_ms: number
  html_report_path: string       // run_dir/newman_report.html
  json_report_path: string       // run_dir/newman_report.json
}
```

### `validate_collection`

8 validation gates (all deterministic):

| # | Gate | Severity |
|---|---|---|
| 1 | Collection filename ends in `_collection.json` | ERROR |
| 2 | `info.name` matches filename | WARN |
| 3 | Every request has all 3 structural `pm.test()` blocks | ERROR |
| 4 | `responseCodeFor<Suffix>` referenced in script | ERROR |
| 5 | No hard-coded URLs or credentials in collection JSON | ERROR |
| 6 | Endpoint coverage vs parsed spec | WARN |
| 7 | `product`, `feature`, `capability` on every data row | ERROR |
| 8 | `_validation_type` set on every data row | ERROR |

```typescript
input:  { run_dir, collection_path, named_model_path }
output: { validation_path, passed: boolean, violations: Violation[], warnings: Warning[] }
```

### `assemble_report`

```typescript
input:  { run_dir, run_id, allow_cost? }
output: {
  structured_dir: string         // run_dir/structured/
  structured_files: string[]     // test_results.jsonl, coverage.json, matrix.jsonl
  endpoint_coverage_pct: number
  pair_coverage_pct: number
  newman_pass_rate: number
  date_parts: { year, month, day }   // for publish_results partition path
}
```

Joins Newman `executions[]` with `*_data.json` by iteration index to produce
structured analytics enriched with product/feature/capability/TSName.

**`test_results.jsonl` row (one per request × iteration):**
```jsonc
{
  "run_id": "2026-06-28T10-00-00Z",
  "api_name": "PetStore",
  "product": "PDC", "feature": "pets", "capability": "list-pets", "domain": null,
  "ts_name": "List pets WITH status=available · expect 200 + only available items",
  "validation_type": "Functional",
  "request_name": "List Pets",
  "operation_id": "listPets",
  "iteration_index": 0,
  "status": "passed",
  "http_status_code": 200,
  "response_time_ms": 45,
  "assertions_total": 5, "assertions_passed": 5, "assertions_failed": 0,
  "assertion_errors": [],
  "year": "2026", "month": "06", "day": "28",
  "started_at": "2026-06-28T10:00:00Z"
}
```

**`coverage.json`:**
```jsonc
{
  "run_id": "...", "api_name": "PetStore", "product": "PDC",
  "endpoint_count": 5, "endpoints_with_tests": 5, "endpoint_coverage_pct": 100,
  "total_matrix_rows": 32, "pair_coverage_pct": 98,
  "newman_iterations_total": 32, "newman_pass_rate_pct": 96.8,
  "business_assertions_total": 64, "business_assertions_failed": 2,
  "validation_passed": true, "tokens_total": 11000, "estimated_cost_usd": 0.024,
  "year": "2026", "month": "06", "day": "28"
}
```

### `publish_results`

```typescript
input: {
  run_dir, run_id,
  s3_uri?: string            // falls back to PUBLISH_S3_URI env var
  partition_by?: "date/api_name/run_id" | "api_name/date/run_id" | "flat"
  include_raw?: boolean      // also upload collection.json, data.json, matrix.csv
  endpoint_url?: string      // MinIO / S3-compatible — PUBLISH_S3_ENDPOINT_URL
  aws_region?: string
}
output: {
  skipped: boolean           // true when S3 URI not configured
  published_uri: string      // full Hive-partitioned destination URI
  files_uploaded: string[]
  duckdb_example: string
}
```

**Hive-partitioned layout:**
```
s3://<bucket>/<prefix>/year=2026/month=06/day=28/api_name=PetStore/run_id=.../
  structured/test_results.jsonl
  structured/coverage.json
  structured/matrix.jsonl
  structured/query_hints.sql
```

DuckDB queries directly from S3 without ETL:
```sql
SELECT feature, validation_type, status, COUNT(*) AS n
FROM read_json_auto('s3://bucket/api-tests/**/test_results.jsonl',
                    hive_partitioning=true, union_by_name=true)
GROUP BY ALL ORDER BY n DESC;
```

---

## 8. Test Data Strategy

### Types of test data

```
Structural parameters (Type A) — from pairwise matrix
  status=available, limit=50, role=admin
  Generated during authoring → committed to *_data.json

Resource IDs (Type B) — from target environment
  patientId=uuid-001, encounterId=enc-456, orgId=ORG-007
  Resolved at execution pre-flight → data_live.json (temporary, per-run)

Fixture records (Type C) — from data generator
  Patient, Encounter, Claim records seeded into the test environment
  One-time setup using Synthea or custom generators → NOT generated by this agent
```

### `test_data_config.json` — developer-provided, one-time setup

Not generated by the agent. Place at `agents/api-test-generator/test_data_config.json`
and commit to VCS (without secrets — use `${ENV_VAR}` substitution).

```jsonc
{
  "model_name": "H360 Healthcare 360 (Synthetic)",
  "datasources": {
    "h360_db": {
      "type": "jdbc",
      "driver": "postgresql",
      "host": "${H360_DB_HOST}",
      "port": 5432,
      "database": "h360",
      "schema": "clinical"
    },
    "h360_lake": {
      "type": "object_store",
      "uri": "${H360_LAKE_URI}",
      "format": "parquet"
    }
  },
  "data_injection": {
    "patientId":   { "datasource": "h360_db",   "query": "SELECT patient_id   FROM clinical.patients    WHERE active=true     LIMIT 20" },
    "encounterId": { "datasource": "h360_db",   "query": "SELECT encounter_id FROM clinical.encounters  WHERE status='finished' LIMIT 10" },
    "orgId":       { "datasource": "h360_lake", "query": "SELECT org_id       FROM read_parquet('${H360_LAKE_URI}/organizations/*.parquet') LIMIT 5" },
    "claimId":     { "datasource": "h360_lake", "query": "SELECT claim_id     FROM read_parquet('${H360_LAKE_URI}/claims/*.parquet') WHERE status='active' LIMIT 10" }
  }
}
```

### H360 entity map

| Entity | API parameter | ID format | Primary datasource |
|---|---|---|---|
| Patient | `patientId` | UUID | `h360_db` — `clinical.patients` |
| Encounter | `encounterId` | UUID | `h360_db` — `clinical.encounters` |
| Organization | `orgId` | `ORG-{N}` | `h360_lake` — Parquet |
| Claim | `claimId` | `CLM-{N}` | `h360_lake` — Parquet |
| Provider | `providerId` | UUID | `h360_db` — `clinical.providers` |
| Medication | `medicationId` | `MED-{N}` | `h360_lake` — Parquet |

---

## 9. Classification Taxonomy

Every data row — mandatory:

| Field | Source | Format | Example |
|---|---|---|---|
| `product` | `--product` option | short uppercase | `PDC`, `H360` |
| `feature` | OpenAPI tag → kebab-case | `pets`, `patients`, `encounters` |
| `capability` | `<method>-<resource>` | `list-pets`, `create-encounter` |
| `domain` | `--domain` option | optional kebab-case | `clinical-data`, `billing` |
| `_validation_type` | pairwise row type | `Smoke` `Functional` `RBAC +ve` `RBAC -ve` `Negative` `Boundary` |

---

## 10. Subagent Contracts

### Pairwise Designer — delegation message

```
You are the Pairwise Designer. Analyze the endpoint model and produce factors_model.json.

ENDPOINT MODEL (inline JSON):
<content of endpoint_model.json>

RULES:
- Extract business factors from parameter descriptions and response schemas.
  Example: "Filter results by status" → factor: status; constraint: IF status is set
  AND 200 → assert all response items have .status === the requested value.
- Numeric params: levels = [null, min, typical, max, max+1]
- Enum params: all enum values are levels
- Constraint block: encode domain rules — infeasible combinations, business invariants,
  always-rejected roles, over-boundary values.
- must_include: smoke per endpoint, one RBAC-ve per unauthorized role per endpoint,
  key business scenarios (filter, pagination, lifecycle steps).
- Include path + method in each endpoint entry (for PICT file headers).
- Return ONLY factors_model JSON — no prose.
```

### Assertion Writer — delegation message

```
You are the Assertion Writer. Write pm.test() assertion scripts for each request.

NAMED ENDPOINT MODEL (inline):
<content of named_endpoint_model.json>

SAMPLE ROWS (inline — first 3 per endpoint from pairwise matrix):
<json>

BUSINESS CONSTRAINTS (from factors_model.json, per endpoint):
<list of businessConstraint strings>

AUTH PROFILE: bearer, token from pm.iterationData.get("token")
BASE_URL: {{base_url}}

For each request:
1. Write the 3 mandatory structural pm.test() blocks (assertion_contract skill).
2. Write N business assertion pm.test() blocks from the businessConstraint list.
   - All dynamic values from pm.iterationData.get("...") — NEVER hard-code.
   - Guard with if (!expected || pm.response.code !== 200) return; where appropriate.
3. Write TSName suggestions per row: "List pets WITH status=available · expect 200 + only available items"

Return: { "assertion_scripts": { "<request_name>": "<script>" }, "tsname_suggestions": { ... } }
```

---

## 11. CI/CD Integration

### GitHub Actions — execution phase

`.github/workflows/api-tests.yml` triggers:
- `workflow_dispatch` — on-demand with `api_name`, `environment`, `run_id` inputs
- `push` to `main` when `*_collection.json` or `api_config.json` paths change

Execution steps (no LLM):
1. Install `newman`, `duckdb` (no Eve dependency)
2. Locate artifacts from `api_config.json` (or named inputs)
3. Data setup: `setup_test_data` → `data_live.json` (if `test_data_config.json` present)
4. Newman run → `newman_report.json`
5. Postprocess → `structured/test_results.jsonl`
6. Publish → S3/MinIO
7. Exit with Newman exit code → CI gate

Required GitHub Secrets:
```
API_BASE_URL             — target environment
PUBLISH_S3_URI           — results bucket
AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
H360_DB_HOST / H360_DB_USER / H360_DB_PASSWORD
H360_LAKE_URI
```

---

## 12. Inputs

| Name | Required | Default | Description |
|---|---|---|---|
| `spec` | yes | — | OpenAPI 3.x YAML/JSON in `inputs/` or URL |
| `api_name` | yes | — | Logical name used in file names |
| `product` | no | derived | Short product ID stamped on every row |
| `domain` | no | none | Optional business domain tag |
| `auth` | no | `none` | `basic`, `bearer`, `apikey`, `none` |
| `base_url` | no | `{{base_url}}` | Base URL placeholder |
| `strength` | no | `2` | Pairwise strength (2=pairs, 3=triples) |
| `run_newman` | no | `true` | Execute Newman locally during authoring |
| `allow_cost` | no | `true` | Compute token cost in report |

---

## 13. Outputs (Authoring — committed to VCS)

| File | Description |
|---|---|
| `*_collection.json` | Postman v2.1.0 collection — test scripts embedded |
| `*_data.json` | Iteration data — structural parameters + TSNames + assertion keys |
| `*_environment.json` | Postman environment — base URL, auth vars |
| `api_config.json` | CI/CD runtime config — base URL, auth profile, endpoint index |
| `collection_data.yml` | Manifest registry — collection → data → category mapping |
| `test_scripts/*.js` | Extracted assertion scripts for code review |
| `pict_models/<opId>.pict` | Per-endpoint PICT factor model — version-control this |
| `pairwise_matrix.csv` | Human-readable test matrix |
| `factors_model.json` | Factor definitions from Pairwise Designer |
| `assertion_scripts.json` | Generated pm.test() scripts from Assertion Writer |
| `validation_report.md` | 8-gate quality check |

## Outputs (Execution — published to data lake)

| File | Description |
|---|---|
| `data_live.json` | Patched iteration data with real resource IDs (ephemeral, per-run) |
| `newman_report.json` | Raw Newman execution report |
| `structured/test_results.jsonl` | Per-execution results — DuckDB queryable |
| `structured/coverage.json` | Run-level metrics |
| `structured/matrix.jsonl` | Pairwise rows with factor values |
| `structured/query_hints.sql` | Ready-to-run DuckDB examples |

---

## 14. Model Configuration

```
MODEL_ORCHESTRATOR       = claude-sonnet-4-6
MODEL_PAIRWISE_DESIGNER  = claude-opus-4-8
MODEL_ASSERTION_WRITER   = claude-haiku-4-5-20251001
```

Resolves `MODEL_<ROLE>_* → MODEL_* → startup error`. No built-in default.

---

## 15. Guardrails

| Guard | Default | Effect |
|---|---|---|
| `ORCHESTRATOR_MAX_STEPS` | 30 | Stops; records partial result |
| `PAIRWISE_MAX_STEPS` | 15 | Completes best-effort factors |
| `ASSERTION_MAX_STEPS` | 20 | Returns partial scripts |
| `NEWMAN_TIMEOUT_MS` | 30000/request | Newman bails on hung requests |
| `NEWMAN_BAIL` | false | Continues on failure (records pass/fail) |

---

## 16. Success Criteria

- ≥ 95% deterministic token consumption (LLM tokens / total tokens ≤ 5%).
- Business assertions present for every endpoint with a filterable/paginatable parameter.
- Execution phase produces identical output for identical inputs and environment (zero LLM).
- ≥ 85% Newman pass rate on well-formed OpenAPI specs against a live environment.
- DuckDB cross-run analytics work immediately after first S3 publish — no ETL.
- PICT model files can be diffed in PRs to show spec coverage changes.
