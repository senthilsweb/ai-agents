---
description: Schema and sections for coverage_report.md and gaps_report.md produced by assemble_report.
---

# Skill: Report Template

Load this skill when interpreting the output of `assemble_report`. The report
tool generates these files deterministically — no LLM is involved.

## `coverage_report.md` structure

```markdown
# API Test Coverage Report — <run_id>

**Generated:** <ISO timestamp>  ·  **API:** <api_name>  ·  **Spec:** <spec_file>

## Summary

| Metric | Value |
|---|---|
| Endpoints in spec | N |
| Endpoints with test rows | N |
| Endpoint coverage | N% |
| Total pairwise pairs (feasible) | N |
| Pairs covered | N |
| Pair coverage | 100% |
| Total test rows (matrix) | N |
| Newman executions | N |
| Newman pass rate | N% |

## Per-endpoint coverage

| Endpoint | Method + Path | Rows | Pair coverage | Newman result |
|---|---|---|---|---|
| listPets | GET /pets | 6 | 100% | ✅ 6/6 |
| createPet | POST /pets | 4 | 100% | ✅ 4/4 |
| getPet | GET /pets/{petId} | 3 | 100% | ⚠️ 2/3 |

## Models used

| Role | Model |
|---|---|
| Orchestrator | claude-sonnet-4-6 |
| Pairwise Designer | claude-opus-4-8 |
| Assertion Writer | claude-haiku-4-5-20251001 |

## Token consumption

| Phase | Input | Output | Total | Source |
|---|---:|---:|---:|---|
| Orchestrate | N | N | N | runtime |
| Pairwise Designer | N | N | N | runtime |
| Assertion Writer | N | N | N | runtime |
| Deterministic tools | 0 | 0 | 0 | runtime |
| **Total** | **N** | **N** | **N** | runtime |

## Token cost

| Model | Cost |
|---|---:|
| claude-sonnet-4-6 | USD N.NNNNNN |
| claude-opus-4-8 | USD N.NNNNNN |
| claude-haiku-4-5-20251001 | USD N.NNNNNN |
| **Total** | **USD N.NNNNNN** |

_Rates are estimates from the shared cost rate-card._

## Artifacts

- `postman_collection.json`
- `postman_environment.json`
- `<ApiNamePrefix>_data.json`
- `pairwise_matrix.csv`
- `newman_report.html`
- `gaps_report.md`
- `summary.json`
```

## `gaps_report.md` structure

```markdown
# API Test Gaps Report — <run_id>

## Uncovered endpoints

> Endpoints present in the OpenAPI spec that have no test rows.

| Endpoint | Method + Path | Reason |
|---|---|---|
| deletePet | DELETE /pets/{petId} | deprecated=true; excluded by default |

## Missing assertions

> Requests with fewer than 3 mandatory pm.test() blocks.

| Request name | Missing blocks |
|---|---|
| Get Pet | Response body validation |

## Infeasible pairs (excluded from coverage)

> Combinations that constraints make structurally invalid.
> These do NOT reduce coverage — they were never feasible.

| Factor A | Value A | Factor B | Value B | Reason |
|---|---|---|---|---|
| role | anonymous | limit | 100 | anonymous always yields 401 regardless of limit |

## Validation violations

> Issues found by validate_collection.

| Severity | Rule | Location | Detail |
|---|---|---|---|
| ERROR | Missing assertion | createPet - Content-Type | pm.test("Content-Type header validation") absent |
| WARN | Vague TSName | listPets iteration 3 | outcome clause missing ("· expect …") |

## Recommended actions

- [ ] Add manual test for `deletePet` (deprecated — confirm removal or add negative TC).
- [ ] Fix missing Content-Type assertion in `createPet`.
- [ ] Normalize TSName for iteration 3 of `listPets`.
```

## `summary.json` shape

```jsonc
{
  "runId": "2026-06-27T10-00-00Z",
  "api_name": "PetStore",
  "spec_file": "petstore.yaml",
  "status": "ok",            // ok | partial | failed
  "endpoint_coverage_pct": 100,
  "pair_coverage_pct": 100,
  "newman_pass_rate": 95,
  "total_rows": 22,
  "validation_passed": true,
  "models": {
    "orchestrator": "claude-sonnet-4-6",
    "pairwise_designer": "claude-opus-4-8",
    "assertion_writer": "claude-haiku-4-5-20251001"
  },
  "tokens": { "input": 0, "output": 0, "total": 0 },
  "cost": { "rated": true, "amount": 0.0, "currency": "USD", "byModel": [] },
  "budget": { "steps": null, "wallClockSeconds": null, "exceeded": false }
}
```
