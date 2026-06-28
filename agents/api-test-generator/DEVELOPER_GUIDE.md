# Developer Guide
## API Test Generator — OpenAPI → Postman/Newman with Pairwise Combinatorics

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

The orchestrator passes the full endpoint model to the Pairwise Designer
but instructs it to analyze only the specified path/method.

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
| `product` | derived | `PDC` — stamped on every data row |
| `domain` | none | `data-governance` — optional classification |
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

## Test Coverage Requirements & Acceptance Criteria

This section confirms every class of test that the agent generates. Use this
as a checklist when reviewing generated output.

### Classification (every row, mandatory)

```jsonc
{
  "product":    "PDC",              // short product identifier
  "feature":    "pets",            // OpenAPI tag → kebab-case
  "capability": "list-pets",       // <method>-<resource> → kebab-case
  "domain":     "catalog"          // optional business domain
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
| RBAC +ve | `Create pet as editor · expect 201 + id returned` |
| RBAC -ve | `List pets as anonymous · expect 401` |
| Negative | `Get pet WITH id=nonexistent · expect 404` |
| Boundary | `Create pet WITH name over max length · expect 400` |
| Functional | `Update pet WITH tag=null · expect 200 + tag removed` |

**Rules:**
- Outcome after `· expect` is mandatory
- HTTP status always present
- `as <role>` for RBAC variants, `WITH <param>=<value>` for value variants
- Max 120 characters

**File names:**

| Artifact | Pattern | Example |
|---|---|---|
| Collection | `<ApiName>_collection.json` | `PetStore_collection.json` |
| Data | `<ApiName>_data.json` | `PetStore_data.json` |
| Environment | `<ApiName>_environment.json` | `PetStore_environment.json` |
| Config | `api_config.json` | `api_config.json` |
| Manifest | `collection_data.yml` | `collection_data.yml` |

**Request names** from `operationId`:
`listPets` → `List Pets` | `createPet` → `Create Pet` | `getPetById` → `Get Pet By Id`

**Folder names** from OpenAPI tags:
`pets` → `Pets` | `user-auth` → `User Auth`

---

### Test Types Generated

#### Positive tests

| Type | `_validation_type` | When generated |
|---|---|---|
| Smoke | `Smoke` | First must-include row per endpoint — all valid values, authorized role |
| RBAC positive | `RBAC +ve` | Authorized role (admin/viewer) with valid params |
| Functional | `Functional` | Normal-path variations from pairwise matrix |

**Smoke rows** are explicit `must_include` entries — guaranteed to appear
regardless of pairwise reduction.

#### Negative tests

| Type | `_validation_type` | Scenario |
|---|---|---|
| RBAC negative | `RBAC -ve` | Anonymous/unauthorized role → expect 401/403 |
| Not found | `Negative` | Valid ID format, non-existent resource → expect 404 |
| Missing required | `Negative` | Omit required field → expect 400/422 |
| Wrong type | `Negative` | String in integer field → expect 400/422 |
| Duplicate | `Negative` | POST with already-existing resource → expect 409 |

**RBAC -ve rows** are enforced by constraint + must_include — at least one per
unauthorized role variant per endpoint.

#### Boundary / outlier tests

| Scenario | `_validation_type` | Factor levels |
|---|---|---|
| At minimum | `Boundary` | `minimum` value from schema |
| At maximum | `Boundary` | `maximum` value from schema |
| Below minimum | `Boundary` | `minimum - 1` or `null` if optional |
| Above maximum | `Boundary` | `maximum + 1` → expect 400/422 |
| Empty string | `Boundary` | `""` for string params with minLength |
| Max length + 1 | `Boundary` | String exceeding `maxLength` → expect 400 |
| Empty collection | `Functional` | `offset` beyond end of result set → empty array |
| Null optional | `Functional` | `null` / omitted optional field → 200 still returns |

#### Error and response code coverage

Every data row drives assertions through three data keys:

```
responseCodeFor<Suffix>   → integer   e.g. 200, 201, 400, 401, 403, 404, 409, 422
responseTextFor<Suffix>   → string    expected substring in response body (or null)
contentTypeFor<Suffix>    → string    e.g. "application/json", "text/html" (or null)
```

Common response code coverage per endpoint type:

| HTTP Status | When covered |
|---|---|
| 200 | GET success (Smoke, Functional, RBAC +ve) |
| 201 | POST success |
| 204 | DELETE success (no body) |
| 400 | Invalid input, boundary violations |
| 401 | Anonymous / expired token (RBAC -ve) |
| 403 | Authenticated but unauthorized (RBAC -ve with role != anonymous) |
| 404 | Valid format but non-existent resource |
| 409 | Duplicate resource on POST |
| 422 | Semantic validation failure |
| 4xx/5xx | From OpenAPI `responses` block — coverage is spec-driven |

---

### Assertion Contract (every request, non-negotiable)

```
Block 1: Status code          → pm.test("Status code", ...)
Block 2: Content-Type header  → pm.test("Content-Type header validation", ...)
Block 3: Response body        → pm.test("Response body validation", ...)
```

All values come from `pm.iterationData.get(...)` — no hard-coded expectations
in scripts. This means the data file is independently extensible: add a row,
define `responseCodeFor*`, run Newman.

---

### What is NOT covered (explicit scope boundary)

| Out of scope | Why |
|---|---|
| Load / performance testing | Newman is sequential; use k6 or Gatling |
| Security fuzzing | Use OWASP ZAP or Burp Suite |
| UI / browser automation | Use Playwright |
| Race conditions / concurrency | Sequential runner; not combinatorially modeled |
| Contract testing (Pact) | Different protocol — schema validation is included |
| Mocking / stub servers | Requires separate tooling (WireMock etc.) |

---

## Output Artifacts — What Each File Is For

| File | Audience | Purpose |
|---|---|---|
| `*_collection.json` | Postman / Newman | Run tests — never edit for data changes |
| `*_data.json` | QA / developers | Add/remove scenarios without touching collection |
| `*_environment.json` | Postman | Set base URL and auth per environment |
| `api_config.json` | CI/CD pipelines | Config without opening Postman files |
| `collection_data.yml` | Test runners | Registry of which collection + data pairs to run |
| `test_scripts/*.js` | Code reviewers | Human-readable assertion scripts for PR review |
| `pict_models/*.pict` | Test architects | Factor model audit trail — **check this in to VCS** |
| `pairwise_matrix.csv` | Test leads | Human-readable matrix — what scenarios were generated |
| `structured/test_results.jsonl` | Analytics | DuckDB / BI tools — per-execution results |
| `structured/coverage.json` | Dashboards | Run-level metrics in machine-readable form |
| `validation_report.md` | Pipeline | Automated quality gate |

---

## DuckDB Query Cookbook

Run these locally against the `structured/` folder, or against S3 after publishing:

```sql
-- Test results from a single run
SELECT request_name, validation_type, status, http_status_code, response_time_ms
FROM read_json_auto('runs/*/structured/test_results.jsonl', union_by_name=true)
ORDER BY validation_type, request_name;

-- Failures only — with assertion errors
SELECT ts_name, assertion_errors
FROM read_json_auto('runs/*/structured/test_results.jsonl', union_by_name=true)
WHERE status = 'failed';

-- Coverage trend across CI runs (after S3 publish)
SELECT year, month, day, api_name, newman_pass_rate_pct, pair_coverage_pct
FROM read_json_auto('s3://bucket/api-tests/**/coverage.json',
                    hive_partitioning=true, union_by_name=true)
ORDER BY year, month, day;

-- P95 response time per capability
SELECT capability,
       PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms) AS p95_ms,
       COUNT(*) AS n
FROM read_json_auto('s3://bucket/api-tests/**/test_results.jsonl',
                    hive_partitioning=true, union_by_name=true)
WHERE status = 'passed'
GROUP BY capability ORDER BY p95_ms DESC;

-- RBAC coverage — confirm every endpoint has at least one -ve row
SELECT request_name,
       SUM(CASE WHEN validation_type = 'RBAC -ve' THEN 1 ELSE 0 END) AS rbac_neg_rows,
       SUM(CASE WHEN validation_type = 'Smoke'    THEN 1 ELSE 0 END) AS smoke_rows
FROM read_json_auto('runs/*/structured/test_results.jsonl', union_by_name=true)
GROUP BY request_name
HAVING rbac_neg_rows = 0;  -- ← find endpoints missing RBAC -ve coverage
```

---

## Extending the Agent

### Add a new validation type

1. Add the label to `_validation_type` values table in `agent/skills/naming_rules.md`.
2. Update `assemble_collection.ts` to detect and assign the new type based on row content.
3. Update `assemble_report.ts` structured output if you want it reported separately.

### Customize the factor analysis

Edit `agent/subagents/pairwise-designer/skills/factor_analysis.md` to add your
domain-specific factor types (e.g., multi-tenancy, data-residency, feature flags).
The Pairwise Designer loads this skill and applies it per endpoint.

### Add a constraint rule

In the Pairwise Designer delegation message, include domain rules:

```
Additional constraints:
- If the endpoint requires a parent_id and parent does not exist, expect 404.
- If user.role = 'guest', limit is always capped at 10 regardless of the limit param.
```

The designer encodes these into `constraints[]` in `factors_model.json`.
The IPOG tool enforces them deterministically.

### Increase pairwise strength for a specific endpoint

Set `strength: 3` in the factors_model for that operationId (you can instruct
the Pairwise Designer to use strength 3 for high-risk endpoints). Strength 3
means every triple of parameter values is covered — more rows, but justified for
auth grant/revoke, financial ops, or data lineage endpoints.

### Add JSON schema validation to assertions

In the Assertion Writer delegation message, include the resolved JSON schema for
each response. The writer adds `pm.response.to.have.jsonSchema(schema)` in
Branch B of the assertion contract.

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

The `publish_results` tool passes `--endpoint-url` to the AWS CLI — compatible
with any S3-protocol store.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `MODEL_* not set` startup error | Missing env var | Set all three `MODEL_*` vars in `.env` |
| `parse_openapi` warnings about unresolved `$ref` | Spec uses external refs | Pass `--bundle` the spec first with `swagger-bundle` |
| Pairwise Designer returns no constraints | Sparse spec (no auth, no limits) | Add a delegation note: "add RBAC constraints — assume anonymous role should be rejected" |
| Newman fails with `ECONNREFUSED` | Base URL not reachable from sandbox | Update `{{base_url}}` in environment JSON to an accessible host |
| `structured/test_results.jsonl` has `status: "not_run"` | Newman was skipped or failed | Re-run with `run_newman=true` and a reachable base URL |
| `validate_collection` fails on classification | `product` missing from data rows | Pass `--product YourProduct` option when running the agent |
| AWS CLI not found in sandbox | Minimal Docker image | Pre-install `awscli` in sandbox or use the `PUBLISH_S3_ENDPOINT_URL` env to route via MinIO |
| DuckDB `hive_partitioning` returns empty | Wrong glob path | Ensure path ends with `/**/*.jsonl` not `/*.jsonl` |

---

## References

- **Combinatorial testing theory and PICT model design**
  [Applying Combinatorial Science & Discrete Mathematics to API Testing](https://www.linkedin.com/pulse/applying-combinatorial-science-discrete-mathematics-karuppaiah-qgste/)
  — Three-layer PICT model, constraint block importance, C(4,2) pair reduction math

- **IPOG algorithm** — Lei, Y. & Tai, K.-C. (1998). "In-Parameter-Order: A Test Generation
  Strategy for Pairwise Testing." IEEE HASE 1998. The deterministic algorithm implemented
  in `agent/tools/generate_pairwise_matrix.ts`.

- **Postman Collection v2.1.0 schema**
  https://schema.getpostman.com/json/collection/v2.1.0/collection.json

- **Newman CLI** — https://www.npmjs.com/package/newman

- **DuckDB JSONL + Hive partitioning**
  https://duckdb.org/docs/data/json/overview — `read_json_auto` with `hive_partitioning=true`

- **OpenAPI 3.x specification** — https://spec.openapis.org/oas/v3.1.0

- **Eve agent framework** — https://vercel.com/eve
