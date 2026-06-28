# Generate Business-Verified API Tests from an OpenAPI Spec: Developer Guide

The agent reads your OpenAPI spec, understands what each endpoint is _supposed to do_,
generates a minimum pairwise matrix that covers both business rules and HTTP mechanics,
and produces a Newman-executable Postman collection with structured analytics.

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 24.x | Agent runtime |
| Eve CLI | latest | `npm i -g eve` |
| Docker | any | Sandbox isolation |
| Newman | auto-installed | Installed in sandbox at runtime |
| AWS CLI | auto-installed | Only needed if publishing to S3/MinIO |
| DuckDB | optional | For cross-run analytics queries |

---

## Quick Start

```bash
# 1. Clone / navigate
cd agents/api-test-generator

# 2. Configure
cp .env.example .env
# Edit .env: set MODEL_ORCHESTRATOR, MODEL_PAIRWISE_DESIGNER, MODEL_ASSERTION_WRITER

# 3. Drop your OpenAPI spec
cp /path/to/your/api-spec.yaml agent/sandbox/workspace/inputs/

# 4. Run
npm run dev
```

The agent prompts for the spec file and API name, then runs the full pipeline.

---

## Usage Patterns

### Full spec — all endpoints

```
Generate tests for petstore.yaml — api_name: PetStore, auth: basic
```

### Target a single endpoint

```
Generate tests for GET /pets only from petstore.yaml — api_name: PetStore
```

### Target specific operations by operationId

```
Generate tests for operationIds: listPets, createPet — spec: petstore.yaml
```

### Spec from URL

```
Generate tests from https://petstore3.swagger.io/api/v3/openapi.json — api_name: PetStore
```

### Full options

| Option | Default | Example |
|---|---|---|
| `spec` | required | `petstore.yaml` or a URL |
| `api_name` | required | `PetStore` |
| `product` | derived | short product identifier — stamped on every data row |
| `domain` | none | optional business domain (`data-governance`) |
| `auth` | `none` | `basic`, `bearer`, `apikey`, `none` |
| `base_url` | `{{base_url}}` | `{{base_url}}` |
| `strength` | `2` | `3` for high-risk endpoints |
| `run_newman` | `true` | `false` to skip execution |
| `publish_uri` | from `.env` | `s3://bucket/api-tests` |

---

## Configuration Reference (`.env`)

```bash
# Models (required — no built-in defaults)
MODEL_ORCHESTRATOR=claude-sonnet-4-6
MODEL_PAIRWISE_DESIGNER=claude-opus-4-8
MODEL_ASSERTION_WRITER=claude-haiku-4-5-20251001

# Newman
NEWMAN_TIMEOUT_MS=30000
NEWMAN_BAIL=false

# Step budgets (infinite-loop guard)
ORCHESTRATOR_MAX_STEPS=30
PAIRWISE_MAX_STEPS=15
ASSERTION_MAX_STEPS=20

# Object store publish (optional)
PUBLISH_S3_URI=s3://my-bucket/api-tests
PUBLISH_S3_ENDPOINT_URL=http://minio:9000   # MinIO / S3-compatible
PUBLISH_S3_BUCKET_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
PUBLISH_PARTITION_BY=date/api_name/run_id   # or api_name/date/run_id | flat
PUBLISH_INCLUDE_RAW=false
```

---

## Two Phases: Authoring and Execution

### Phase 1 — Test Authoring (run once, when the spec changes)

```bash
# Run the Eve agent — this is the LLM-involved step
npm run dev
# > Generate tests for petstore.yaml — api_name: PetStore, auth: bearer
```

Produces and commits to VCS:
- `*_collection.json` — Postman collection with embedded assertion scripts
- `*_data.json` — pairwise iteration rows (structural parameters)
- `*_environment.json` — base URL and auth variable placeholders
- `api_config.json` — machine-readable config for the execution runner
- `pict_models/*.pict` — factor model audit trail

Do NOT re-run authoring on every CI build. Re-run only when:
- The OpenAPI spec changes (new endpoints, parameter changes)
- The assertion contract changes
- The pairwise strength changes for a specific endpoint

### Phase 2 — Test Execution (CI/CD, on-demand, no LLM)

```bash
# Run the execution runner — deterministic, no LLM
npm run execute -- --api PetStore --env staging
```

The execution runner:
1. Reads `api_config.json` to locate collection + data + environment files
2. If `test_data_config.json` is present — runs data setup (DuckDB queries JDBC/Object Store)
3. Runs Newman with the (optionally patched) data file
4. Produces `structured/test_results.jsonl` and `structured/coverage.json`
5. Publishes to S3/MinIO if `PUBLISH_S3_URI` is set
6. Exits with Newman's exit code — CI pass/fail gate

---

## Test Data Setup

### The three types of test data

| Type | What it is | Who provides it | When |
|---|---|---|---|
| Structural parameters | `status=available`, `limit=50`, `role=admin` | Agent (pairwise matrix) | Authoring |
| Resource IDs | `patientId=UUID-001`, `encounterId=ENC-456` | Target environment (JDBC/S3) | Execution pre-flight |
| Fixture / seed records | Patient, Encounter, Claim records | Data generator (Synthea etc.) | One-time environment setup |

The authoring agent generates structural parameters. Resource IDs must come from
the target environment — you cannot test `GET /patients/{patientId}` meaningfully
without a `patientId` that actually exists in that environment.

### `test_data_config.json` — one-time developer setup

Create this file at `agents/api-test-generator/test_data_config.json` (not generated
by the agent — you provide it once). It describes your data model and data sources:

```json
{
  "model_name": "H360 Healthcare 360 (Synthetic)",
  "description": "Synthea-generated patient records seeded into staging environment",
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
      "format": "parquet",
      "description": "Synthea Parquet files, Hive-partitioned by entity type"
    }
  },
  "data_injection": {
    "patientId": {
      "datasource": "h360_db",
      "query": "SELECT patient_id FROM clinical.patients WHERE active = true ORDER BY RANDOM() LIMIT 20",
      "description": "Active patient UUIDs for test scenarios"
    },
    "encounterId": {
      "datasource": "h360_db",
      "query": "SELECT encounter_id FROM clinical.encounters WHERE status = 'finished' LIMIT 10"
    },
    "orgId": {
      "datasource": "h360_lake",
      "query": "SELECT org_id FROM read_parquet('${H360_LAKE_URI}/organizations/*.parquet') LIMIT 5"
    },
    "claimId": {
      "datasource": "h360_lake",
      "query": "SELECT claim_id FROM read_parquet('${H360_LAKE_URI}/claims/*.parquet') WHERE status='active' LIMIT 10"
    }
  }
}
```

See `test_data_config.example.json` for the complete H360 entity reference.

### How data injection works

DuckDB handles both sources:

```sql
-- JDBC source (via DuckDB jdbc extension):
INSTALL jdbc; LOAD jdbc;
ATTACH 'jdbc:postgresql://${H360_DB_HOST}:5432/h360' AS h360 (TYPE JDBC);
SELECT patient_id FROM h360.clinical.patients WHERE active = true LIMIT 20;

-- Object Store source (DuckDB native):
SELECT org_id FROM read_parquet('s3://h360-synthetic/v1/organizations/*.parquet') LIMIT 5;
```

The execution runner collects these IDs, then patches `*_data.json` rows:
- Rows with `"patientId": "{{patientId}}"` → replaced with `"patientId": "uuid-abc-123"`
- Rows with `"orgId": "{{orgId}}"` → replaced with `"orgId": "ORG-007"`
- Rows without these fields are passed through unchanged

The original `*_data.json` (with placeholders) is never overwritten. A
`data_live.json` is written to the run folder for this execution only.

### H360 entity reference

When writing your Pairwise Designer delegation notes, use these entity names:

| Entity | Primary ID | Format | Where used in APIs |
|---|---|---|---|
| Patient | `patientId` | UUID | `/patients/{id}`, `/encounters?patientId=` |
| Encounter | `encounterId` | UUID | `/encounters/{id}`, `/claims?encounterId=` |
| Organization | `orgId` | `ORG-{N}` | `/organizations/{id}`, multi-tenant filters |
| Claim | `claimId` | `CLM-{N}` | `/claims/{id}`, billing endpoints |
| Provider | `providerId` | UUID | `/providers/{id}`, care team endpoints |
| Medication | `medicationId` | `MED-{N}` | `/medications/{id}`, prescriptions |

---

## GitHub Actions — Execution Trigger

The execution phase integrates with GitHub Actions via `.github/workflows/api-tests.yml`.
Two trigger modes:

```yaml
# On-demand: workflow_dispatch with inputs
on:
  workflow_dispatch:
    inputs:
      api_name:    { description: 'API name', required: true, default: 'PetStore' }
      environment: { description: 'Target env', default: 'staging',
                     type: choice, options: [staging, production] }
      run_id:      { description: 'Specific run ID (blank = latest)', required: false }

# Automatic: on push when collection artifacts change
  push:
    branches: [main]
    paths:
      - 'agents/api-test-generator/runs/**/*_collection.json'
      - 'agents/api-test-generator/runs/**/api_config.json'
```

Key steps in the workflow:
1. Install `newman` + `duckdb` (no Eve, no LLM dependencies)
2. Locate collection artifacts from `api_config.json`
3. Run data setup if `test_data_config.json` is present (env vars from GitHub Secrets)
4. Run Newman → exit code controls CI pass/fail
5. Publish structured JSONL to S3 (from GitHub Secrets)
6. Upload test artifacts as workflow artifacts (30-day retention)

Required GitHub Secrets:

| Secret | Purpose |
|---|---|
| `API_BASE_URL` | Target environment base URL |
| `PUBLISH_S3_URI` | Results bucket `s3://bucket/prefix` |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | S3 publish credentials |
| `H360_DB_HOST` / `H360_DB_USER` / `H360_DB_PASSWORD` | JDBC datasource |
| `H360_LAKE_URI` | Object Store datasource root URI |

See `.github/workflows/api-tests.yml` for the complete workflow template.

---

## Test Coverage

Coverage has two layers. Both are generated automatically — the spec provides
everything needed to derive them.

```
Layer 1 — Business functionality         Layer 2 — HTTP mechanics
────────────────────────────────────     ────────────────────────────────────
Does filtering by status=available       Did the server return 200?
  return ONLY available pets?            Is Content-Type application/json?
Does limit=5 produce ≤ 5 items?          Does a 401 come back for anonymous?
Does POST echo name back in response?    Does the schema have required fields?
Does sort=name produce alpha order?      Does DELETE return 204?
Does GET /pets/{id} after DELETE → 404?  Does over-limit param → 400?
```

Layer 1 is derived from the spec's parameter descriptions, response schemas,
and endpoint summaries — not from generic test type lists.

---

### Business Functionality: How It's Derived

The Pairwise Designer (claude-opus-4-8) reads the full endpoint model —
parameters, descriptions, response schemas, examples, enum lists — and
extracts business rules that become test factors and constraints.

#### From parameter descriptions

```yaml
# Spec fragment:
  parameters:
    - name: status
      description: "Filter results to only pets with this status"
      schema: { type: string, enum: [available, pending, sold] }
    - name: limit
      description: "Maximum items to return"
      schema: { type: integer, minimum: 1, maximum: 100 }
```

**What the agent extracts:**

| What it reads | Factor/Level extracted | Business rule encoded |
|---|---|---|
| `enum: [available, pending, sold]` | `status: [available, pending, sold, null]` | Each enum value becomes a factor level |
| "Filter results to only pets with this status" | Business constraint | When `status=available`, every item in response must have `status === "available"` |
| `minimum: 1, maximum: 100` | `limit: [null, 1, 50, 100, 101]` | Boundary levels auto-derived; 101 → expect 400 |
| "Maximum items to return" | Business constraint | When `limit=N`, `response.length ≤ N` |

#### From response schemas

```yaml
# Spec fragment:
  responses:
    '200':
      content:
        application/json:
          schema:
            type: array
            items:
              required: [id, name, status]
              properties:
                id:     { type: integer, minimum: 1 }
                status: { enum: [available, pending, sold] }
```

**What the agent extracts:**

| What it reads | Assertion generated |
|---|---|
| `required: [id, name, status]` | Every response item must have all three fields present |
| `id: { type: integer, minimum: 1 }` | `id` must be a positive integer |
| `status.enum: [available, pending, sold]` | Returned `status` must be within declared enum values |

#### From endpoint descriptions (POST / PUT)

```yaml
# Spec fragment:
  post:
    summary: "Create a new pet"
    description: "Creates a pet. Returns the pet record with an assigned id."
    requestBody:
      content:
        application/json:
          schema:
            required: [name]
            properties:
              name:   { type: string }
              status: { enum: [available, pending, sold] }
```

**What the agent extracts:**

| What it reads | Assertion generated |
|---|---|
| "Returns the pet record with an assigned id" | POST 201 → `response.id` must be a positive integer |
| `required: [name]` in requestBody | Test case: omit `name` → expect 400/422 |
| Sending `name: "Fido"` in body | Verify `response.name === "Fido"` (echo check) |

---

### Concrete Derivation Chain

Full spec → pairwise factor → assertion → data row:

```
Spec: GET /pets  parameter: status  enum: [available, pending, sold]
      description: "Filter results to only pets with this status"
      response: array of { id, name, status } where status: enum[...]

           ↓  Pairwise Designer (claude-opus-4-8)

factors_model.json:
  operationId: listPets
  factors:
    - name: status
      levels: [available, pending, sold, null]
      businessConstraint: |
        When status is set and response is 200, every item in the response
        array must have .status === the requested status value.
        Tests that server-side filtering is actually applied.

           ↓  Assertion Writer (claude-haiku-4-5)

test_scripts/List_Pets.js (excerpt beyond the 3 structural blocks):
  pm.test("Filter: all items match requested status", function () {
    var expected = pm.iterationData.get("expectFilterValue");
    if (!expected || pm.response.code !== 200) return;
    pm.response.json().forEach(function (item) {
      pm.expect(item.status).to.eql(expected);
    });
  });
  pm.test("Pagination: response length respects limit", function () {
    var max = pm.iterationData.get("expectMaxItems");
    if (!max || pm.response.code !== 200) return;
    pm.expect(pm.response.json()).to.have.length.at.most(parseInt(max));
  });
  pm.test("Schema: id is a positive integer on each item", function () {
    if (pm.response.code !== 200) return;
    pm.response.json().forEach(function (item) {
      pm.expect(item.id).to.be.a("number").above(0);
    });
  });

           ↓  assemble_collection

PetStore_data.json row:
  {
    "product":               "PetStore",
    "feature":               "pets",
    "capability":            "list-pets",
    "TSName":                "List pets WITH status=available · expect 200 + only available items",
    "_validation_type":      "Functional",
    "status":                "available",
    "limit":                 "10",
    "responseCodeForListPets":   200,
    "responseTextForListPets":   "available",
    "contentTypeForListPets":    "application/json",
    "expectFilterValue":         "available",
    "expectMaxItems":            "10"
  }
```

No expected values are hard-coded in the test script. Add a new status variant
by adding a new data row — no collection change needed.

---

### Cross-endpoint Workflow Tests

When the spec contains CRUD operations on the same resource, the Pairwise
Designer generates lifecycle rows as a `must_include` group:

```
POST /pets              → TSName: "Create pet as admin · expect 201 + id assigned"
                          captures id: pm.collectionVariables.set("petId", response.json().id)
                          business assertion: response.name === sent name

GET /pets/{{petId}}     → TSName: "Get created pet · expect 200 + matches created data"
                          business assertion: response.id === captured petId

PUT /pets/{{petId}}     → TSName: "Update pet name · expect 200 + name reflected"
  { name: "Rex" }         business assertion: response.name === "Rex"

DELETE /pets/{{petId}}  → TSName: "Delete pet · expect 204"

GET /pets/{{petId}}     → TSName: "Get deleted pet · expect 404"
                          business assertion: response body contains "not found"
```

The RBAC-negative version (anonymous role → 401 at step 1) is a separate
set of rows with `_validation_type: RBAC -ve`.

---

### Classification (every row, mandatory)

```jsonc
{
  "product":    "PetStore",     // short product identifier
  "feature":    "pets",         // OpenAPI tag → kebab-case
  "capability": "list-pets",    // <method>-<resource> → kebab-case
  "domain":     "catalog"       // optional business domain
}
```

Every iteration row in `*_data.json` must carry `product`, `feature`,
`capability`. Missing fields = ERROR in `validate_collection`.

---

### Naming Convention

**TSName** — unique human-readable test identifier:

```
<Verb> <Resource> [WITH|WITHOUT|USING <variant>] · expect <observable outcome>
```

| Type | Example TSName |
|---|---|
| Smoke | `List pets as admin WITH limit=10 · expect 200 + array` |
| Functional (business filter) | `List pets WITH status=available · expect 200 + only available items` |
| Functional (business echo) | `Create pet WITH name=Fido · expect 201 + id assigned + name echoed` |
| RBAC +ve | `Create pet as editor · expect 201 + id returned` |
| RBAC -ve | `List pets as anonymous · expect 401` |
| Negative | `Get pet WITH id=nonexistent · expect 404` |
| Boundary | `Create pet WITH name over max length · expect 400` |

**Rules:** outcome after `· expect` is mandatory; HTTP status always present; max 120 characters.

**File names:**

| Artifact | Pattern | Example |
|---|---|---|
| Collection | `<ApiName>_collection.json` | `PetStore_collection.json` |
| Data | `<ApiName>_data.json` | `PetStore_data.json` |
| Environment | `<ApiName>_environment.json` | `PetStore_environment.json` |
| Config | `api_config.json` | `api_config.json` |
| Manifest | `collection_data.yml` | `collection_data.yml` |

---

### Test Types Generated

#### Smoke (must run first)

One row per endpoint — all valid parameter values, authorized role — verifies
the endpoint responds before the matrix expands. Always a `must_include` row.
`_validation_type: Smoke`

#### Functional (business behavior)

Rows where parameter combinations exercise a business rule extracted from the spec:
- Filter by enum value → verify response reflects the filter
- Pagination limit → verify response item count
- Create with a specific field value → verify field echoed in response
- Update a field → verify updated value appears in response

`_validation_type: Functional`

#### RBAC Positive / Negative

| Type | `_validation_type` | Scenario |
|---|---|---|
| RBAC +ve | `RBAC +ve` | Authorized role, valid params → 200/201 |
| RBAC -ve | `RBAC -ve` | Anonymous / unauthorized → 401/403, HTML error body |

At least one RBAC -ve row per endpoint is enforced by the PICT model constraint.

#### Negative (error paths derived from spec)

| Scenario | `_validation_type` | Source in spec |
|---|---|---|
| Omit required field | `Negative` | `required: [...]` in requestBody schema |
| Non-existent resource | `Negative` | Path param + `404` in responses block |
| Wrong field type | `Negative` | Schema type definition |
| Duplicate resource | `Negative` | `409` in responses block |
| Semantic validation | `Negative` | `422` in responses block |

#### Boundary / Outlier (derived from numeric constraints)

| Scenario | Factor level | Expected |
|---|---|---|
| Below minimum | `minimum - 1` or `null` | 400/422 |
| At minimum | `minimum` value | 200 |
| At maximum | `maximum` value | 200 |
| Above maximum | `maximum + 1` | 400/422 |
| Empty string | `""` for `minLength > 0` | 400 |
| Max length + 1 | `maxLength + 1` chars | 400 |

`_validation_type: Boundary`

---

### HTTP Status Code Coverage

Every data row specifies its expected code via `responseCodeFor<Suffix>`.
The agent covers every status code declared in the spec's `responses` block:

| HTTP Status | When covered |
|---|---|
| 200 | GET success, PUT success |
| 201 | POST success |
| 204 | DELETE success (no body) |
| 400 | Invalid input, boundary violations, missing required field |
| 401 | Anonymous / expired token (RBAC -ve) |
| 403 | Authenticated but unauthorized role (RBAC -ve) |
| 404 | Valid format but non-existent resource |
| 409 | Duplicate resource on POST |
| 422 | Semantic validation failure |
| Any `4xx/5xx` in spec | Derived from `responses` block — spec-driven, not assumed |

---

### Assertion Contract (every request)

```
Block 1: Status code          → pm.test("Status code", ...)
Block 2: Content-Type header  → pm.test("Content-Type header validation", ...)
Block 3: Response body        → pm.test("Response body validation", ...)
          - 4xx + HTML: check error message substring
          - 200 + JSON: check expected body substring
          - 200 + XML:  check XML element
          - fallback: body is not empty

+ Business assertions derived from spec (see derivation chain above)
  → filter correctness, pagination bounds, required fields, echo checks
```

All values come from `pm.iterationData.get(...)` — nothing hard-coded in scripts.

---

### Out of Scope

| Not covered | Use instead |
|---|---|
| Load / performance testing | k6, Gatling |
| Security fuzzing | OWASP ZAP, Burp Suite |
| UI / browser automation | Playwright |
| Race conditions / concurrency | Sequential runner — not combinatorially modeled |
| Mocking / stub servers | WireMock |

---

## Output Artifacts — What Each File Is For

| File | Audience | Purpose |
|---|---|---|
| `*_collection.json` | Postman / Newman | Run tests — edit only for assertion logic fixes |
| `*_data.json` | QA / developers | Add/remove scenarios without touching collection |
| `*_environment.json` | Postman | Set base URL and auth per environment |
| `api_config.json` | CI/CD pipelines | Config without opening Postman files |
| `collection_data.yml` | Test runners | Registry of which collection + data pairs to run |
| `test_scripts/*.js` | Code reviewers | Human-readable assertion scripts for PR review |
| `pict_models/*.pict` | Test architects | Factor model audit trail — **check this in to VCS** |
| `pairwise_matrix.csv` | Test leads | Human-readable matrix — all scenarios at a glance |
| `structured/test_results.jsonl` | Analytics | DuckDB / BI — per-execution results with product/feature/capability |
| `structured/coverage.json` | Dashboards | Run-level metrics in machine-readable form |
| `validation_report.md` | Pipeline | Automated quality gate |

---

## DuckDB Query Cookbook

```sql
-- What did the tests cover? (per capability + validation type)
SELECT capability, validation_type, COUNT(*) AS n,
       SUM(CASE WHEN status='passed' THEN 1 ELSE 0 END) AS passed
FROM read_json_auto('runs/*/structured/test_results.jsonl', union_by_name=true)
GROUP BY capability, validation_type ORDER BY capability;

-- Which business assertions failed?
SELECT ts_name, http_status_code, assertion_errors
FROM read_json_auto('runs/*/structured/test_results.jsonl', union_by_name=true)
WHERE status = 'failed'
ORDER BY capability;

-- RBAC gaps — endpoints missing at least one RBAC -ve row
SELECT capability,
       SUM(CASE WHEN validation_type = 'RBAC -ve' THEN 1 ELSE 0 END) AS rbac_neg_rows
FROM read_json_auto('runs/*/structured/test_results.jsonl', union_by_name=true)
GROUP BY capability
HAVING rbac_neg_rows = 0;

-- Coverage trend across CI runs (after S3 publish)
SELECT year, month, day, api_name, newman_pass_rate_pct, pair_coverage_pct
FROM read_json_auto('s3://bucket/api-tests/**/coverage.json',
                    hive_partitioning=true, union_by_name=true)
ORDER BY year, month, day;

-- P95 response time per capability
SELECT capability,
       PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms) AS p95_ms
FROM read_json_auto('s3://bucket/api-tests/**/test_results.jsonl',
                    hive_partitioning=true, union_by_name=true)
WHERE status = 'passed'
GROUP BY capability ORDER BY p95_ms DESC;
```

---

## Extending the Agent

### Add business rules the spec doesn't state

In the Pairwise Designer delegation message:

```
Additional constraints:
- GET /pets?status=available must only return pets whose status field is "available".
  Add a business constraint: IF status is set AND response is 200,
  all response items must have status === the requested value.
- If the endpoint requires a parent_id that doesn't exist, expect 404.
- Guest role: limit is always server-capped at 10 regardless of the limit param.
```

### Increase pairwise strength for high-risk endpoints

```
Generate tests for operationIds: authorizeGrant — strength: 3
```

Strength 3 = every triple of parameter values covered.
Use for auth grant/revoke, financial, or data-lineage endpoints.

### Add JSON schema validation

In the Assertion Writer delegation message:

```
For listPets, include JSON schema validation:
pm.response.to.have.jsonSchema(<paste the resolved JSON schema here>)
```

### Publish to a different S3-compatible store

```bash
# MinIO
PUBLISH_S3_URI=s3://my-bucket/api-tests
PUBLISH_S3_ENDPOINT_URL=http://minio.internal:9000

# Backblaze B2
PUBLISH_S3_URI=s3://my-bucket/api-tests
PUBLISH_S3_ENDPOINT_URL=https://s3.us-west-004.backblazeb2.com

# Cloudflare R2
PUBLISH_S3_URI=s3://my-bucket/api-tests
PUBLISH_S3_ENDPOINT_URL=https://<account-id>.r2.cloudflarestorage.com
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `MODEL_* not set` startup error | Missing env var | Set all three `MODEL_*` vars in `.env` |
| `parse_openapi` unresolved `$ref` warnings | Spec uses external refs | Bundle first: `swagger-cli bundle spec.yaml -o bundled.yaml` |
| Pairwise Designer returns no business constraints | Sparse spec (no descriptions, no examples) | Add explicit delegation note: "Derive these business rules: [list them]" |
| Tests pass but business behavior is wrong | Business constraints not in factors_model | Check `pict_models/*.pict` — if missing, add rules via delegation message |
| Newman fails with `ECONNREFUSED` | Base URL unreachable from sandbox | Update `{{base_url}}` in environment JSON to an accessible host |
| `test_results.jsonl` has `status: "not_run"` | Newman skipped or failed | Re-run with `run_newman=true` and a reachable base URL |
| `validate_collection` fails on classification | `product` missing from data rows | Pass `--product YourProduct` when running the agent |
| DuckDB `hive_partitioning` returns empty | Wrong glob path | Ensure path ends with `/**/*.jsonl` not `/*.jsonl` |

---

## References

- **Combinatorial testing theory and PICT model design**  
  [Applying Combinatorial Science & Discrete Mathematics to API Testing](https://www.linkedin.com/pulse/applying-combinatorial-science-discrete-mathematics-karuppaiah-qgste/)  
  Senthilnathan Karuppaiah — three-layer PICT model, constraint block importance, C(4,2) pair reduction math

- **IPOG algorithm** — Lei, Y. & Tai, K.-C. (1998). "In-Parameter-Order: A Test Generation
  Strategy for Pairwise Testing." IEEE HASE 1998. Implemented in `generate_pairwise_matrix.ts`.

- **Postman Collection v2.1.0 schema** — https://schema.getpostman.com/json/collection/v2.1.0/collection.json

- **Newman CLI** — https://www.npmjs.com/package/newman

- **DuckDB JSONL + Hive partitioning** — https://duckdb.org/docs/data/json/overview

- **OpenAPI 3.x specification** — https://spec.openapis.org/oas/v3.1.0

- **Eve agent framework** — https://vercel.com/eve
