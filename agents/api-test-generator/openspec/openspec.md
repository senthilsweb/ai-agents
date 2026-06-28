# OpenSpec: Agentic OpenAPI → Postman/Newman Test Generation Harness

**Status:** Proposed → In Progress  
**Agent path:** `agents/api-test-generator/`  
**Version:** 1.0.0

---

## 1. Problem

Generating API automation from an OpenAPI specification is inconsistent, expensive,
and hard to standardize across teams. Off-the-shelf generators produce boilerplate
tests but ignore organizational naming standards, assertion conventions, folder
structure, environment conventions, and combinatorial test strategies.

---

## 2. Goals

- **Deterministic wherever possible.** Parsing, naming, folder generation, parameter
  extraction, pairwise combination math, and collection assembly never touch a model.
- **LLM only where reasoning adds value.** Factor analysis (complex test strategy),
  assertion script authoring, and natural-language test descriptions.
- Produce **production-ready Postman collections** (v2.1.0 schema).
- Execute using **Newman** and capture results.
- Generate **pairwise/combinatorial** test cases to maximize coverage while
  minimizing execution time.
- **Right-sized models.** Avoid over-paying or triggering infinite reasoning loops.
  Each model is selected for the cognitive weight of its task.
- Support organization-specific skills, rules, and naming conventions via
  file-based skills loaded per phase.
- Fit naturally into the Eve-based multi-agent harness.

---

## 3. Non-goals

- End-to-end UI automation.
- Fuzzing or security testing.
- Performance / load testing.
- Modifying the Newman/Postman framework runtime files.

---

## 4. Architecture

```
OpenAPI Spec
     │
     ▼ [deterministic tool]
 parse_openapi ──────────────────── endpoint_model.json
     │
     ▼ [deterministic tool]
 apply_naming_rules ─────────────── named_endpoint_model.json
     │
     ▼ [Pairwise Designer subagent — claude-opus-4-8]
 Factor Analysis & Strategy ──────── factors_model.json
     │
     ▼ [deterministic tool]
 generate_pairwise_matrix ────────── pairwise_matrix.csv / matrix.json
                                     pict_models/<opId>.pict  (per-endpoint PICT model, for VCS)
     │
     ▼ [Assertion Writer subagent — claude-haiku-4-5-20251001]
 Assertion Script Generation ─────── assertion_scripts.json
     │
     ▼ [deterministic tool]
 assemble_collection ────────────── *_collection.json      (collection + test scripts)
                                     *_data.json            (iteration data — FREELY extensible)
                                     *_environment.json     (Postman env vars)
                                     api_config.json        (base URL, auth, endpoints — separate config)
                                     collection_data.yml    (central manifest registry)
                                     test_scripts/*.js      (extracted scripts for review/VCS)
     │
     ▼ [deterministic tool]
 run_newman ──────────────────────── newman_report.html / JSON
     │
     ▼ [deterministic tool]
 validate_collection ────────────── validation_report.md
     │
     ▼ [deterministic tool]
 assemble_report ─────────────────── coverage_report.md
                                      gaps_report.md
                                      summary.json
```

---

## 5. Agent Roles

### 5.1 Orchestrator (`claude-sonnet-4-6`)

**Rationale:** Mid-tier model with strong instruction-following. The orchestrator's
job is coordination and bookkeeping — it does not perform complex combinatorial
reasoning (that's the Pairwise Designer) or bulk generation (that's the Assertion
Writer). Sonnet is correctly priced for the coordination task.

**Responsibilities:**
- Receive the user's OpenAPI spec path (or URL) and options.
- Create the run folder.
- Call deterministic tools in the correct sequence.
- Pass context to subagents in their delegation messages.
- Collect subagent outputs and drive the next tool call.
- Write the final summary.

**Cap:** `ORCHESTRATOR_MAX_STEPS` (default 30). On exceed, record phase trace and
return best effort.

### 5.2 Pairwise Designer subagent (`claude-opus-4-8`)

**Rationale:** Identifying the right test factors, levels, constraints, and
must-include rows from a real OpenAPI spec requires genuine reasoning — understanding
business semantics, inferring boundary levels from parameter types, recognizing
constraint relationships. Opus 4.8 is the correct model for this single, complex
architectural task.

**Responsibilities:**
- Receive the full `endpoint_model.json` (passed inline in delegation message).
- For each endpoint, identify:
  - Which parameters are worth factoring (skip internal/deprecated).
  - Levels for each factor (enum values, boolean, boundary numerics, role variants).
  - Constraints that make combinations infeasible.
  - Must-include rows (smoke, RBAC-positive, RBAC-negative).
- Return `factors_model.json` — a structured JSON the deterministic IPOG tool consumes.
- **Does NOT compute combinations.** The IPOG math is in `generate_pairwise_matrix`.

**Cap:** Single turn. Bounded by `PAIRWISE_MAX_STEPS` (default 15). No self-verify loop.

### 5.3 Assertion Writer subagent (`claude-haiku-4-5-20251001`)

**Rationale:** Writing `pm.test()` assertion scripts is repetitive bulk generation
following a fixed contract. Haiku is the fastest and cheapest Claude model —
exactly right for generating dozens of assertion blocks following a strict template.
Using Opus or Sonnet here wastes tokens on non-reasoning work.

**Responsibilities:**
- Receive endpoint definitions + sample pairwise rows.
- For each request name in the collection, write the three mandatory `pm.test()`
  blocks following `assertion_contract` skill exactly.
- Suggest `TSName` strings for each iteration row (human-readable, encodes scenario
  + expected outcome).
- Infer `responseTextFor*` expected substrings from the OpenAPI response examples.
- Return `assertion_scripts.json` — keyed by request name.

**Cap:** `ASSERTION_MAX_STEPS` (default 20). Processes all endpoints in one call.

---

## 6. Deterministic vs LLM Boundary (explicit)

| Concern | Mechanism | LLM? |
|---|---|---|
| Run folder + `run-meta.json` | `create_run` tool | No |
| Parse OpenAPI 3.x + resolve `$ref` | `parse_openapi` tool (swagger-parser) | No |
| Naming rules (folder, file, TSName prefix) | `apply_naming_rules` tool | No |
| IPOG pairwise combination math | `generate_pairwise_matrix` tool | No |
| PICT model file generation | `generate_pairwise_matrix` tool | No |
| Postman collection v2.1 JSON assembly | `assemble_collection` tool | No |
| Postman environment + api_config.json + collection_data.yml | `assemble_collection` tool | No |
| Extracted test scripts (`test_scripts/*.js`) | `assemble_collection` tool | No |
| Newman execution | `run_newman` tool (shell) | No |
| Naming compliance + classification field checks | `validate_collection` tool | No |
| Assertion coverage + credential hygiene checks | `validate_collection` tool | No |
| Coverage arithmetic + structured analytics output | `assemble_report` tool | No |
| Publish to S3-compatible object store | `publish_results` tool | No |
| Factor identification + levels + constraints | Pairwise Designer (Opus) | **Yes** |
| pm.test() assertion scripts | Assertion Writer (Haiku) | **Yes** |
| TSName iteration labels | Assertion Writer (Haiku) | **Yes** |
| Negative / boundary scenario descriptions | Assertion Writer (Haiku) | **Yes** |
| Missing example inference | Assertion Writer (Haiku) | **Yes** |

---

## 7. Tool Contracts

### `create_run`

```typescript
input: {
  request: string           // short description of the run
  options: Record<string, unknown>
}
output: {
  run_dir: string           // e.g. "runs/2026-06-27T10-00-00Z"
  run_id: string
  sandbox_run_dir: string
  host_run_dir: string
  started_at: string
  start_epoch: number
}
```

### `parse_openapi`

```typescript
input: {
  spec_path: string         // path in sandbox /workspace/inputs/ or URL
}
output: {
  endpoint_model_path: string   // written to run_dir/endpoint_model.json
  info: { title, version, description }
  endpoint_count: number
  schema_count: number
  warnings: string[]
}
```

Endpoint model shape (per endpoint):
```jsonc
{
  "operationId": "listPets",
  "method": "GET",
  "path": "/pets",
  "tag": "pets",
  "summary": "List all pets",
  "parameters": [
    { "name": "limit", "in": "query", "required": false,
      "schema": { "type": "integer", "maximum": 100 } }
  ],
  "requestBody": null,
  "responses": {
    "200": { "description": "OK", "content_type": "application/json",
             "schema_ref": "#/components/schemas/Pets",
             "example": { "... ": "..." } },
    "default": { "description": "error", "content_type": "application/json" }
  },
  "security": ["bearerAuth"]
}
```

### `apply_naming_rules`

```typescript
input: {
  run_dir: string
  endpoint_model_path: string
  api_name: string         // e.g. "PetStore"
  category: string         // e.g. "pets"
}
output: {
  named_model_path: string   // run_dir/named_endpoint_model.json
  collection_name: string    // "PetStore_collection.json"
  data_file_name: string     // "PetStore_data.json"
  folder_map: Record<string, string>  // tag → Postman folder name
}
```

### `generate_pairwise_matrix`

```typescript
input: {
  run_dir: string
  factors_model_path: string   // from Pairwise Designer
}
output: {
  matrix_path: string          // run_dir/pairwise_matrix.json
  csv_path: string             // run_dir/pairwise_matrix.csv
  pict_models_dir: string      // run_dir/pict_models/<opId>.pict — per-endpoint PICT model files
  total_rows: number
  endpoints_covered: number
  pair_coverage_pct: number    // 100 for feasible pairs
}
```

`factors_model.json` schema (produced by Pairwise Designer). Include `path` and
`method` so the IPOG tool can emit accurate `.pict` file headers:

```jsonc
{
  "endpoints": {
    "listPets": {
      "path": "/pets",
      "method": "GET",
      "strength": 2,
      "factors": [
        { "name": "limit", "levels": ["null", "1", "100", "101"] },
        { "name": "role",  "levels": ["admin", "viewer", "anonymous"] }
      ],
      "constraints": [
        { "if": { "role": "anonymous" }, "expect_status": 401 }
      ],
      "must_include": [
        { "limit": "10", "role": "admin" }
      ]
    }
  }
}
```

PICT model file example (written to `pict_models/listPets.pict`):
```
# PICT Model — listPets (GET /pets)
# Strength: 2 (pairwise)
# Generated: 2026-06-28T10:00:00Z
# Tip: The constraint block is the most valuable part — keep it version-controlled.

limit: null, 1, 100, 101
role: admin, viewer, anonymous

# Constraints
IF [role] = "anonymous" → expect HTTP 401 (see constraints in factors_model.json)
```

### `assemble_collection`

```typescript
input: {
  run_dir: string
  api_name: string
  product: string                  // mandatory classification — e.g. "PDC"
  domain?: string                  // optional classification — e.g. "data-governance"
  auth_profile: {
    type: "basic" | "bearer" | "apikey" | "none"
    username_var?: string
    password_var?: string
    token_var?: string
    key_header?: string
    key_var?: string
  }
  base_url_var: string             // "{{base_url}}"
  environment_name?: string
  environment_vars: Record<string, string>
}
output: {
  collection_path: string          // run_dir/<ApiName>_collection.json
  environment_path: string         // run_dir/<ApiName>_environment.json
  data_files: string[]             // run_dir/<ApiName>_data.json
  api_config_path: string          // run_dir/api_config.json  (runtime config — separate)
  collection_data_path: string     // run_dir/collection_data.yml  (manifest registry)
  test_scripts_dir: string         // run_dir/test_scripts/<RequestName>.js
  request_count: number
  iteration_count: number
}
```

**Separation of concerns enforced by this tool:**
- `*_collection.json` — test scripts embedded; never touch to extend data.
- `*_data.json` — iteration rows only; add/remove rows freely.
- `*_environment.json` — Postman variable resolution.
- `api_config.json` — for CI/CD tooling; base URL, auth profile, endpoint index.
- `collection_data.yml` — central manifest following the `collection_data.yml` pattern.
- `test_scripts/*.js` — read-only extracted scripts for human code review.

**Every data row carries mandatory classification:**
```jsonc
{ "product": "PDC", "feature": "pets", "capability": "list-pets" }
```
Optional `domain` field added when `domain` option is set.

### `run_newman`

```typescript
input: {
  run_dir: string
  collection_path: string
  environment_path?: string
  data_path?: string
  timeout_ms?: number              // default 30000 per request
  bail?: boolean                   // default false
}
output: {
  exit_code: number
  passed: number
  failed: number
  skipped: number
  duration_ms: number
  html_report_path: string         // run_dir/newman_report.html
  json_report_path: string         // run_dir/newman_report.json
  summary: string                  // one-line result
}
```

### `validate_collection`

```typescript
input: {
  run_dir: string
  collection_path: string
  named_model_path: string
}
output: {
  validation_path: string          // run_dir/validation_report.md
  passed: boolean
  violations: Violation[]
  warnings: Warning[]
}
```

Checks:
- Collection file name ends in `_collection.json`
- `info.name` matches file name minus `.json`
- Every request has the three mandatory `pm.test()` blocks
- Every request name has matching `responseCodeFor*` key in script
- No hard-coded URLs or credentials in collection JSON
- Endpoint coverage (every parsed endpoint appears in at least one request)
- Every data row has `product`, `feature`, `capability` classification fields
- Every data row has `_validation_type` set

### `assemble_report`

```typescript
input: {
  run_dir: string
  run_id: string
  allow_cost?: boolean
}
output: {
  coverage_report_path: string     // run_dir/coverage_report.md
  gaps_report_path: string         // run_dir/gaps_report.md
  summary_path: string             // run_dir/summary.json
  structured_dir: string           // run_dir/structured/
  structured_files: string[]       // test_results.jsonl, coverage.json, matrix.jsonl
  endpoint_coverage_pct: number
  pair_coverage_pct: number
  newman_pass_rate: number
  date_parts: { year, month, day } // used by publish_results for partition path
}
```

This tool **also writes** the structured analytics artifacts:

```
run_dir/structured/
  test_results.jsonl  — one JSON line per Newman execution (request × data row)
  coverage.json       — single run-level metrics object
  matrix.jsonl        — one JSON line per pairwise matrix row with factor values
  query_hints.sql     — DuckDB example queries (written by publish_results)
```

**`test_results.jsonl` row schema:**
```jsonc
{
  "run_id": "2026-06-28T10-00-00Z",
  "api_name": "PetStore",
  "product": "PDC",
  "feature": "pets",
  "capability": "list-pets",
  "domain": null,
  "ts_name": "List pets as admin WITH limit=10 · expect 200 + array",
  "validation_type": "Smoke",
  "request_name": "List Pets",
  "operation_id": "listPets",
  "iteration_index": 0,
  "status": "passed",          // "passed" | "failed" | "not_run"
  "http_status_code": 200,
  "response_time_ms": 45,
  "assertions_total": 3,
  "assertions_passed": 3,
  "assertions_failed": 0,
  "assertion_errors": [],
  "year": "2026", "month": "06", "day": "28",
  "started_at": "2026-06-28T10:00:00Z"
}
```

**`coverage.json` schema:**
```jsonc
{
  "run_id": "...", "api_name": "PetStore", "product": "PDC", "domain": null,
  "spec_file": "petstore.yaml",
  "endpoint_count": 5, "endpoints_with_tests": 5, "endpoint_coverage_pct": 100,
  "total_matrix_rows": 30, "pair_coverage_pct": 98,
  "newman_iterations_total": 30, "newman_iterations_passed": 28,
  "newman_assertions_total": 90, "newman_assertions_failed": 4,
  "newman_pass_rate_pct": 95.6,
  "validation_passed": true, "validation_errors": 0, "validation_warnings": 1,
  "tokens_total": 11000, "estimated_cost_usd": 0.024,
  "duration_ms": 45000,
  "year": "2026", "month": "06", "day": "28",
  "started_at": "...", "completed_at": "..."
}
```

**`matrix.jsonl` row schema:**
```jsonc
{
  "run_id": "...", "api_name": "PetStore", "operation_id": "listPets",
  "row_index": 0, "product": "PDC", "feature": "pets", "capability": "list-pets",
  "strength": 2, "factor_count": 3,
  "year": "2026", "month": "06", "day": "28",
  // + all factor values spread inline:
  "role": "admin", "limit": "10", "sort": "name"
}
```

---

### `publish_results`

```typescript
input: {
  run_dir: string
  run_id: string
  s3_uri?: string          // s3://<bucket> or s3://<bucket>/prefix — falls back to PUBLISH_S3_URI
  partition_by?: "date/api_name/run_id" | "api_name/date/run_id" | "flat"
                           // Default: "date/api_name/run_id" — Hive-partitioned for DuckDB
  include_raw?: boolean    // Also upload collection.json, data.json, etc.
  endpoint_url?: string    // MinIO / S3-compatible endpoint — falls back to PUBLISH_S3_ENDPOINT_URL
  aws_region?: string      // Falls back to PUBLISH_S3_BUCKET_REGION or AWS_DEFAULT_REGION
}
output: {
  skipped: boolean         // true when PUBLISH_S3_URI not configured
  succeeded: boolean
  published_uri: string    // full partitioned destination URI
  partition: { year, month, day, api_name, run_id, mode }
  structured_uri: string   // published_uri/structured/
  files_uploaded: string[] // list of s3:// URIs uploaded
  raw_files_uploaded: string[]
  duckdb_example: string   // ready-to-paste DuckDB SQL
  error: string | null
}
```

**Hive-partitioned path layout (default):**
```
s3://<bucket>/<optional-prefix>/
  year=2026/
    month=06/
      day=28/
        api_name=PetStore/
          run_id=2026-06-28T10-00-00Z/
            structured/
              test_results.jsonl
              coverage.json
              matrix.jsonl
              query_hints.sql
```

**DuckDB queries:**
```sql
-- All test results across runs (DuckDB reads partition columns automatically):
SELECT year, month, feature, capability, status, COUNT(*) AS n
FROM read_json_auto('s3://bucket/api-tests/**/test_results.jsonl',
                    hive_partitioning=true, union_by_name=true)
GROUP BY ALL ORDER BY n DESC;

-- Pass-rate trend per API:
SELECT year, month, api_name, AVG(newman_pass_rate_pct) AS avg_pass_rate
FROM read_json_auto('s3://bucket/api-tests/**/coverage.json',
                    hive_partitioning=true, union_by_name=true)
GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;

-- Slow requests (P95 response time by capability):
SELECT capability, PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms) AS p95_ms
FROM read_json_auto('s3://bucket/api-tests/**/test_results.jsonl',
                    hive_partitioning=true, union_by_name=true)
WHERE status = 'passed'
GROUP BY capability ORDER BY p95_ms DESC;
```

**MinIO config example (`.env`):**
```
PUBLISH_S3_URI=s3://api-test-results/runs
PUBLISH_S3_ENDPOINT_URL=http://minio:9000
PUBLISH_S3_BUCKET_REGION=us-east-1
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin
```

---

## 8. Subagent Input/Output Contracts

### Pairwise Designer — input (delegation message)

```
You are the Pairwise Designer. Analyze the following OpenAPI endpoint model and
produce factors_model.json following the factor_analysis skill.

ENDPOINT MODEL:
<inline JSON from endpoint_model.json>

RULES:
- Factor strength: 2 (pairwise) unless endpoint has security/money/lineage impact → 3
- Include role-based factors when security scopes differ per role
- Numeric params: levels = [null/omit, min, typical, max-1, max, max+1]
- Boolean params: levels = [true, false]
- Enum params: all values are levels
- Constraints: any combination that always yields the same status can be collapsed
- must_include: at minimum one positive smoke row per endpoint
- Return ONLY the factors_model JSON (no prose)
```

### Pairwise Designer — output

```jsonc
{
  "endpoints": { "<operationId>": { "strength": 2, "factors": [...], "constraints": [...], "must_include": [...] } }
}
```

### Assertion Writer — input (delegation message)

```
You are the Assertion Writer. Write pm.test() assertion scripts for each request
following the assertion_contract skill exactly.

NAMED ENDPOINT MODEL:
<inline JSON — endpoint name, method, path, responses>

SAMPLE ITERATION ROWS:
<inline JSON — first 3 rows of the pairwise matrix per endpoint>

AUTH PROFILE: basic auth, credentials from pm.iterationData
BASE_URL: {{base_url}}

Return assertion_scripts.json: { "<request_name>": "<full pm.test() script string>", ... }
Also return tsname_suggestions: { "<operationId>.<rowIndex>": "<TSName string>" }
Return ONLY JSON (no prose).
```

### Assertion Writer — output

```jsonc
{
  "assertion_scripts": {
    "List Pets": "var respCode = pm.iterationData.get(\"responseCodeForListPets\");\npm.test(\"Status code\", function () { pm.response.to.have.status(parseInt(respCode)); });\n..."
  },
  "tsname_suggestions": {
    "listPets.0": "List pets as admin WITH limit=10 · expect 200 + array",
    "listPets.1": "List pets as anonymous · expect 401"
  }
}
```

---

## 8b. Test Case Classification Taxonomy

Every test case and every iteration row in the data file must carry:

| Field | Required | Source | Format | Example |
|---|---|---|---|---|
| `product` | **Yes** | `--product` option or derived from `api_name` | Short uppercase | `PDC`, `PBA` |
| `feature` | **Yes** | OpenAPI tag (first), kebab-case | `pets`, `users-and-communities` |
| `capability` | **Yes** | `<method>-<resource>` pattern | `list-pets`, `create-pet` |
| `domain` | No | `--domain` option | kebab-case | `data-governance`, `catalog` |

These fields enable:
- Filtering test runs by product/feature without reading collection files.
- Reporting across products in a single Newman runner.
- Test management tool (PractiTest, GitHub) auto-registration.
- `collection_data.yml` manifest grouping by category.

---

## 8c. Artifact Separation Principle

The three concerns of test automation are **strictly separated**:

```
Test scripts (HOW to assert)   → *_collection.json embedded event scripts
Test data   (WHAT to test)     → *_data.json iteration rows — extend freely
Configuration (WHERE to run)   → api_config.json + *_environment.json
```

**What this means in practice:**
- Adding a new scenario = add one JSON object to `*_data.json`. Zero collection changes.
- Changing the base URL = edit `api_config.json` and `*_environment.json`. Zero collection changes.
- Fixing an assertion = edit `*_collection.json` OR re-generate with the agent.
- No expected values appear in collection scripts — all values come from `pm.iterationData.get(...)`.
- No credentials appear in collection JSON — only `{{variable}}` placeholders.

---

## 9. Inputs

| Name | Required | Default | Description |
|---|---|---|---|
| `spec` | yes | — | Path to OpenAPI 3.x spec in `inputs/` or a URL |
| `api_name` | yes | — | Logical API name (used in file names + `info.name`) |
| `product` | no | derived from `api_name` | Short product identifier (`PDC`, `PBA`). Added to every iteration row. |
| `domain` | no | none | Optional business domain tag (`data-governance`). Added to every iteration row when set. |
| `category` | no | derived from first tag | Postman folder category |
| `auth` | no | `none` | `basic`, `bearer`, `apikey`, `none` |
| `base_url` | no | `{{base_url}}` | Base URL placeholder |
| `env_name` | no | `{api_name} Local` | Postman environment name |
| `strength` | no | `2` | Pairwise strength (2=pairs, 3=triples) |
| `run_newman` | no | `true` | Whether to execute Newman after assembly |
| `allow_cost` | no | `true` | Whether to compute token cost |

---

## 10. Outputs

All written to `agent/sandbox/workspace/runs/<run-id>/`:

| File | Description |
|---|---|
| `endpoint_model.json` | Parsed, normalized endpoint model |
| `named_endpoint_model.json` | After naming rules applied |
| `factors_model.json` | Factor definitions per endpoint (from Pairwise Designer) |
| `pairwise_matrix.json` | Combination matrix per endpoint |
| `pairwise_matrix.csv` | Human-readable CSV of test rows |
| `assertion_scripts.json` | pm.test() scripts per request (from Assertion Writer) |
| `*_collection.json` | Final Postman v2.1.0 collection with embedded test scripts |
| `*_environment.json` | Postman environment (base URL, credentials) |
| `*_data.json` | Newman iteration data — **extend freely** without touching collection |
| `api_config.json` | Separate runtime config (base URL, auth profile, endpoint index) |
| `collection_data.yml` | Central manifest registry (category → collection → data) |
| `test_scripts/*.js` | Extracted assertion scripts for code review / VCS diff |
| `pict_models/<opId>.pict` | PICT model files for auditability (one per endpoint) |
| `newman_report.html` | Newman HTML report |
| `newman_report.json` | Newman JSON report |
| `validation_report.md` | Collection validation results including classification checks |
| `coverage_report.md` | Coverage metrics and summary |
| `gaps_report.md` | Uncovered endpoints, missing assertions |
| `summary.json` | Machine-readable run summary |
| `report.md` | Human run report (timing + tokens + cost) |
| `phases/orchestrate.json` | Orchestrator phase trace |
| `phases/pairwise-designer.json` | Pairwise Designer phase trace |
| `phases/assertion-writer.json` | Assertion Writer phase trace |
| `phases/report.json` | Report tool phase trace |

---

## 11. Model Configuration

```
MODEL_ORCHESTRATOR          = claude-sonnet-4-6
MODEL_PAIRWISE_DESIGNER     = claude-opus-4-8
MODEL_ASSERTION_WRITER      = claude-haiku-4-5-20251001
```

Each resolves `MODEL_<ROLE>_* → MODEL_* → startup error`. No built-in default.

---

## 12. Guardrails Against Infinite Loops

| Guard | Default | Effect |
|---|---|---|
| `ORCHESTRATOR_MAX_STEPS` | 30 | Orchestrator stops and records partial result |
| `PAIRWISE_MAX_STEPS` | 15 | Pairwise Designer completes on best-effort |
| `ASSERTION_MAX_STEPS` | 20 | Assertion Writer returns partial scripts |
| `NEWMAN_TIMEOUT_MS` | 30000/request | Newman bails on hung requests |
| `NEWMAN_BAIL` | false | Newman continues on failure (record pass/fail) |

All are env-configurable and logged in `run-meta.json`.

---

## 13. Success Criteria

- ≥ 95% deterministic token consumption (LLM tokens / total tokens ≤ 5%).
- Repeatable outputs from identical inputs and identical model seeds.
- ≥ 85% Newman pass rate on well-formed OpenAPI specs.
- Reduced manual editing of generated collections.
- Pairwise matrix covers 100% of feasible parameter pairs.

---

## 14. Future Enhancements

- Build evaluation dataset from accumulated high-quality runs.
- Distill repetitive assertion patterns into a smaller domain-specific model.
- Support AsyncAPI / gRPC specs.
- GitHub Actions integration (auto-run on spec PR).
- Direct upload to Postman workspace via API.
