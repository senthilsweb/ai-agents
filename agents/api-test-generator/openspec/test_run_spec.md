# Test Run Spec: Validate the API Test Generator Implementation

**Purpose:** End-to-end acceptance test for the `agents/api-test-generator` agent.
Run this in a new session to verify the full pipeline works against a known spec.

**Input spec:** `agent/sandbox/workspace/inputs/h360_patients_api.yaml`  
**Reference docs:** `ARCHITECTURE.md`, `DEVELOPER_GUIDE.md`, `openspec/openspec.md`

---

## What This Spec Is Designed to Exercise

`h360_patients_api.yaml` is a 5-endpoint H360 healthcare API written specifically
to trigger every agent capability:

| Capability being tested | How it's triggered in the spec |
|---|---|
| Enum filter business rule | `GET /patients?status=` with enum `[active, inactive, deceased]` + description "All patients in the response will have status equal to this value" |
| Pagination business rule | `limit` param with description "Response array will never contain more items than this value" |
| Required fields check | `Patient` schema has `required: [id, firstName, lastName, status, orgId]` |
| Echo check (POST) | `createPatient` description: "firstName and lastName from the request body are echoed back unchanged" |
| Status transition validation | `updatePatient` description: "deceased → active transition not allowed" → 422 |
| ID assigned on creation | `createPatient` response description: "server-assigned UUID in the id field" |
| CRUD lifecycle | `POST /patients` → `GET /patients/{id}` → `PUT /patients/{id}` → `DELETE /patients/{id}` → `GET /patients/{id}` → 404 |
| RBAC (bearer auth) | `securitySchemes.bearerAuth` with scopes `read:patients`, `write:patients`, `delete:patients`; anonymous → 401; wrong scope → 403 |
| Boundary: limit | `minimum: 1, maximum: 100` → levels [null, 1, 50, 99, 100, 101] → 101 expects 400 |
| Boundary: name length | `firstName.maxLength: 100` → level: 101-char string → 400 |
| 404 on non-existent ID | `GET /patients/{patientId}` for unknown UUID → 404 + "Patient not found" |
| 409 on duplicate | `POST /patients` for same demographic key → 409 |
| 422 on semantic invalid | Future `dateOfBirth`, or `deceased → active` status transition |
| `orgId` multi-tenant filter | `orgId` query param on `listPatients` |

---

## Agent Invocation

```bash
cd agents/api-test-generator
npm run dev
```

When prompted, use this message:

```
Generate tests for h360_patients_api.yaml — api_name: H360Patients, product: H360,
domain: clinical-data, auth: bearer, strength: 2, run_newman: false
```

Use `run_newman: false` for the authoring-only test run (no live server required).
Set `run_newman: true` only when a live H360 staging environment is available.

---

## Acceptance Checkpoints

### Checkpoint 1 — Parse (`endpoint_model.json`)

Expected: 5 endpoints parsed, 0 warnings.

```
operationId      method   path
───────────────────────────────────────────────────
listPatients     GET      /patients
createPatient    POST     /patients
getPatient       GET      /patients/{patientId}
updatePatient    PUT      /patients/{patientId}
deletePatient    DELETE   /patients/{patientId}
```

Verify: `endpoint_model.json` contains all 5, each has `parameters[]`, `responses{}`,
`security: ["bearerAuth"]`, and the full `description` text.

---

### Checkpoint 2 — Naming (`named_endpoint_model.json`)

Expected file names:

| Artifact | Expected |
|---|---|
| Collection | `H360Patients_collection.json` |
| Data file | `H360Patients_data.json` |
| Environment | `H360Patients_environment.json` |
| Folder | `Patients` (from tag `patients`) |

Expected request names: `List Patients`, `Create Patient`, `Get Patient`,
`Update Patient`, `Delete Patient`

---

### Checkpoint 3 — Pairwise factors (`factors_model.json`)

Verify the Pairwise Designer extracted these business constraints:

**`listPatients`:**
- Factor `status` with levels `[active, inactive, deceased, null]`
- Business constraint: `IF status is set AND 200 → ALL response.patients[].status === status`
- Factor `limit` with levels `[null, 1, 50, 100, 101]`
- Business constraint: `IF limit=N AND 200 → response.patients.length ≤ N`
- Factor `role` with levels `[admin, viewer, anonymous]`
- Constraint: `IF role=anonymous → expect 401`
- Constraint: `IF limit=101 → expect 400`
- Must-include: smoke row (status=active, limit=20, role=admin)
- Must-include: RBAC-ve row (role=anonymous)

**`createPatient`:**
- Factor `firstName` with levels `[valid, null(omit), over_maxlength]`
- Business constraint: `IF firstName sent AND 201 → response.firstName === sent value`
- Business constraint: `IF status not sent → response.status === "active"` (default)
- Constraint: `IF firstName=null → expect 400`
- Constraint: `IF firstName=over_maxlength → expect 400`
- Must-include: duplicate row → expect 409
- Must-include: lifecycle smoke row

**`deletePatient`:**
- Must-include: lifecycle row after createPatient (captures patientId from prior step)
- Business constraint: `IF 204 → subsequent GET /patients/{patientId} must return 404`

**`updatePatient`:**
- Factor `status` with levels `[active, inactive, deceased, deceased_to_active]`
- Business constraint: `IF deceased_to_active → expect 422`
- Business constraint: `IF 200 → response.firstName === sent firstName` (echo check)

---

### Checkpoint 4 — Pairwise matrix

Expected: 35–55 total rows across all 5 endpoints (pairwise at strength 2).

```bash
# From the run folder:
wc -l <rundir>/pairwise_matrix.csv   # should be 36-56 (header + rows)
```

Verify `pict_models/` contains 5 files:
```
pict_models/listPatients.pict
pict_models/createPatient.pict
pict_models/getPatient.pict
pict_models/updatePatient.pict
pict_models/deletePatient.pict
```

Each `.pict` file must have a constraint block. `listPatients.pict` must contain
the filter correctness and pagination business rules.

---

### Checkpoint 5 — Assertion scripts (`assertion_scripts.json`)

**`listPatients` script must contain:**
- `pm.test("Status code", ...)` — structural
- `pm.test("Content-Type header validation", ...)` — structural
- `pm.test("Response body validation", ...)` — structural
- `pm.test("Filter: all patients match requested status", ...)` — **business**
- `pm.test("Pagination: response length respects limit", ...)` — **business**
- `pm.test("Schema: required fields present on each patient", ...)` — **business**

**`createPatient` script must contain:**
- 3 structural blocks
- `pm.test("Schema: id is a non-empty string (UUID)", ...)` — **business**
- `pm.test("Echo: firstName matches request", ...)` — **business**
- `pm.test("Default status: active when not specified", ...)` — **business**

---

### Checkpoint 6 — Data file (`H360Patients_data.json`)

Every row must have:
```jsonc
{
  "product":          "H360",
  "feature":          "patients",
  "capability":       "list-patients",    // or create-patient, get-patient, etc.
  "domain":           "clinical-data",
  "TSName":           "<verb> ... · expect <status> ...",
  "_validation_type": "Smoke|Functional|RBAC +ve|RBAC -ve|Negative|Boundary",
  "responseCodeForListPatients": 200,     // (or 400/401/403/404/409/422)
  "contentTypeForListPatients":  "application/json",
  "expectFilterValue": "active"           // (on filter rows — business assertion key)
}
```

Verify these specific TSName patterns exist:
- `List patients WITH status=active · expect 200 + only active patients`
- `List patients as anonymous · expect 401`
- `List patients WITH limit=101 · expect 400`
- `Create patient WITH firstName omitted · expect 400`
- `Create patient as viewer · expect 403`
- `Get patient WITH id=nonexistent · expect 404 + not found`
- `Update patient WITH status=deceased_to_active · expect 422`
- `Delete patient · expect 204`

---

### Checkpoint 7 — Validation report

Run `validate_collection` and verify **0 errors, 0 warnings**:
- ✅ All 5 requests have 3-block assertion coverage
- ✅ All data rows have `product`, `feature`, `capability`
- ✅ All data rows have `_validation_type`
- ✅ No hard-coded credentials in collection JSON
- ✅ 5/5 endpoints covered

---

### Checkpoint 8 — Artifacts (structure and separation)

```
runs/<run-id>/
  H360Patients_collection.json      ← no credentials, no literal values
  H360Patients_data.json            ← all business assertion keys present
  H360Patients_environment.json     ← base_url, token placeholders only
  api_config.json                   ← base_url, auth profile, endpoint index
  collection_data.yml               ← manifest with H360Patients entry
  test_scripts/
    List_Patients.js
    Create_Patient.js
    Get_Patient.js
    Update_Patient.js
    Delete_Patient.js
  pict_models/
    listPatients.pict       ← constraint block must mention filter rule
    createPatient.pict
    getPatient.pict
    updatePatient.pict
    deletePatient.pict
```

---

## What to Do If a Checkpoint Fails

| Checkpoint | What to investigate |
|---|---|
| 1 — Parse | Check `warnings[]` in tool output; look for unresolved `$ref` |
| 3 — Business constraints missing | The Pairwise Designer didn't read the description text. Re-delegate with explicit note: "Extract filter and pagination business rules from the description fields." |
| 5 — Business assertions missing | The Assertion Writer didn't receive the `businessConstraint` list. Check `factors_model.json` — if constraint is there, update the delegation message to explicitly forward it. |
| 6 — TSNames too generic | Assertion Writer produced generic labels. Re-delegate with sample rows and instruct: "TSName must encode the specific variant being tested." |
| 7 — Validation errors | Read `validation_report.md` — it lists exactly which rule and which request failed. |

---

## Roadmap Items That Must Be Resolved Before Full E2E Execution

These scripts are referenced by the GitHub Actions workflow but not yet written:

| Script | Needed for |
|---|---|
| `scripts/setup_test_data.js` | Injecting real H360 patientId/orgId before Newman |
| `scripts/postprocess_newman.js` | Building `test_results.jsonl` from `newman_report.json` |
| `npm run execute` in `package.json` | Standalone execution without Eve |

To test Newman execution with a live server before those scripts exist:
```bash
newman run H360Patients_collection.json \
  -e H360Patients_environment.json \
  -d H360Patients_data.json \
  --env-var "base_url=https://staging.h360.example.com/api/v1" \
  --env-var "token=<your-bearer-token>" \
  --reporters cli,json \
  --reporter-json-export newman_report.json
```

---

## Session Kickoff Message (copy-paste for new session)

```
We are testing the api-test-generator agent at agents/api-test-generator/.
The implementation is complete for the authoring phase. Refer to:
  - ARCHITECTURE.md — two-phase design, data setup, pipeline diagram
  - DEVELOPER_GUIDE.md — usage, test coverage, H360 data setup
  - openspec/openspec.md — full tool contracts (v2.0)
  - openspec/test_run_spec.md — THIS FILE — acceptance checkpoints

Run the agent against h360_patients_api.yaml (in inputs/) and verify
all 8 checkpoints in test_run_spec.md pass. Start with:

  npm run dev
  > Generate tests for h360_patients_api.yaml — api_name: H360Patients,
    product: H360, domain: clinical-data, auth: bearer, strength: 2,
    run_newman: false

After the run, work through each checkpoint in test_run_spec.md in order.
Report which pass, which fail, and what the root cause is for any failure.
```
