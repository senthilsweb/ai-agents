# API Test Coverage Report — 2026-06-28T15-22-25Z

**Generated:** 2026-06-28T15:29:52.212Z  ·  **API:** H360Patients  ·  **Spec:** h360_patients_api.yaml

## Summary
| Metric | Value |
|---|---|
| Endpoints in spec | 5 |
| Endpoints with test rows | 5 |
| Endpoint coverage | 100% |
| Total test rows (pairwise matrix) | 207 |
| Pair coverage | 100% |
| Newman assertions passed | 0 |
| Newman assertions failed | 0 |
| Newman pass rate | 0% |
| Newman execution time | 0s |
| Validation | ✅ passed |

## Models
| Role | Model |
|---|---|
| Orchestrator | claude-sonnet-4-6 |
| Pairwise Designer | claude-opus-4-8 |
| Assertion Writer | claude-haiku-4-5-20251001 |

## Token consumption
| Phase | Input | Output | Total | Source |
|---|---:|---:|---:|---|
| Orchestrate | 0 | 0 | 0 | unavailable |
| Pairwise Designer | 0 | 0 | 0 | unavailable |
| Assertion Writer | 0 | 0 | 0 | unavailable |
| **Total** | **0** | **0** | **0** | unavailable |

## Token cost
| Model | Cost |
|---|---:|
| — | n/a |
| **Total** | **n/a** |

_Rates are estimates from the shared cost rate-card._

## Artifacts
- `*_collection.json` — Postman collection with embedded test scripts
- `*_environment.json` — Postman environment
- `*_data.json` — Newman iteration data (extend freely without touching collection)
- `api_config.json` — Runtime config (base URL, auth profile, endpoint index)
- `collection_data.yml` — Manifest registry
- `test_scripts/*.js` — Extracted assertion scripts for code review
- `pict_models/*.pict` — PICT model files (recommend version-controlling alongside spec)
- `pairwise_matrix.csv` — Human-readable pairwise matrix
- `newman_report.html` — Newman HTML report

## Structured analytics (DuckDB-queryable)
- `structured/test_results.jsonl` — per-execution results
- `structured/coverage.json` — run-level metrics
- `structured/matrix.jsonl` — pairwise matrix rows

**DuckDB example:**
```sql
SELECT feature, capability, status, COUNT(*) AS n
FROM read_json_auto('structured/test_results.jsonl')
GROUP BY 1, 2, 3 ORDER BY n DESC;
```
