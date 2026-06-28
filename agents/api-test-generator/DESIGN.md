# API Test Generator — Design Notes

Conforms to the monorepo ADRs
[`0001 — Shared Agent Runtime Kit`](../../openspec/adr/0001-shared-agent-runtime-kit.md)
and [`0002 — Cost Matrix`](../../openspec/adr/0002-cost-matrix.md).
Full specification: [`openspec/openspec.md`](openspec/openspec.md).

## Purpose

Turn an OpenAPI 3.x specification into a **production-ready Postman collection**
with Newman execution, pairwise test coverage, and a coverage report — all
recorded under a timestamped `runs/` folder.

## Architecture

```
Orchestrator (Sonnet)
   ├── parse_openapi        [deterministic]  → endpoint model
   ├── apply_naming_rules   [deterministic]  → named model
   ├── Pairwise Designer    [Opus]           → factors_model.json
   ├── generate_pairwise    [deterministic]  → pairwise matrix (IPOG)
   ├── Assertion Writer     [Haiku]          → assertion scripts
   ├── assemble_collection  [deterministic]  → Postman collection + env + data
   ├── run_newman           [deterministic]  → execution report
   ├── validate_collection  [deterministic]  → validation report
   └── assemble_report      [deterministic]  → coverage_report + summary
```

## Determinism

The deterministic/LLM boundary is explicit:

| Concern | Mechanism |
|---|---|
| Run folder + `run-meta.json` | `create_run` (shared `lib/run`) |
| OpenAPI parsing + `$ref` resolution | `parse_openapi` (swagger-parser) |
| Naming rules application | `apply_naming_rules` |
| Pairwise combination math | `generate_pairwise_matrix` (IPOG algorithm) |
| Postman v2.1 collection JSON | `assemble_collection` |
| Newman execution | `run_newman` (shell) |
| Naming & assertion validation | `validate_collection` |
| Report (`report.md` + `summary.json`) | `assemble_report` — pure arithmetic |
| Copy-back to host | `sync_run_to_host` (shared) |

## Model Selection Rationale

| Role | Model | Why |
|---|---|---|
| Orchestrator | `claude-sonnet-4-6` | Coordination only; no heavy reasoning needed |
| Pairwise Designer | `claude-opus-4-8` | Complex factor analysis from real API specs needs full reasoning |
| Assertion Writer | `claude-haiku-4-5-20251001` | Bulk template-following generation; cheapest correct choice |

The Pairwise Designer runs **once** and returns a structured JSON the IPOG
tool consumes. It does not perform the combination math itself. This prevents
the reasoning model from looping on arithmetic it would do less accurately
than deterministic code.

## Infinite-Loop Prevention

- Each subagent is capped by step budget (`PAIRWISE_MAX_STEPS`, `ASSERTION_MAX_STEPS`).
- The orchestrator is capped by `ORCHESTRATOR_MAX_STEPS` (default 30).
- Newman runs with per-request timeout (`NEWMAN_TIMEOUT_MS`, default 30 s).
- No self-verify loops anywhere — verification is a single deterministic tool call.

## Shared Kit

Model resolution, run-folder mirror, usage hook, cost pricing, and copy-back
are consumed from the `shared` workspace package. Agent-private helpers use `#*`.
