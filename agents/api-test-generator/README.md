# API Test Generator

An Eve agent that turns an **OpenAPI 3.x specification** into a production-ready
**Postman collection** with pairwise test coverage, runs it with **Newman**, and
records a coverage report under a timestamped `runs/` folder.

## Quick start

```bash
cd agents/api-test-generator
cp .env.example .env          # fill in your model keys
# Drop your OpenAPI spec into:
#   agent/sandbox/workspace/inputs/your-api.yaml
npm run dev
```

Then message the agent:
```
Generate tests for spec=your-api.yaml api_name=PetStore auth=basic
```

## Options

| Option | Default | Description |
|---|---|---|
| `spec` | required | OpenAPI spec filename in `inputs/` or a URL |
| `api_name` | required | Logical name (used in file names, collection `info.name`) |
| `category` | from first tag | Postman folder category |
| `auth` | `none` | `basic`, `bearer`, `apikey`, `none` |
| `base_url` | `{{base_url}}` | Base URL placeholder |
| `env_name` | `{api_name} Local` | Postman environment name |
| `strength` | `2` | Pairwise strength — 2=pairwise (default), 3=triples |
| `run_newman` | `true` | Execute Newman after collection assembly |
| `allow_cost` | `true` | Compute token cost in report |

## Outputs (per run)

```
runs/<timestamp>/
  <ApiName>_collection.json    ← drop into Postman or run with Newman
  <ApiName>_data.json          ← Newman iteration data (pairwise rows + business keys)
  <ApiName>_environment.json   ← base URL and auth variable placeholders
  api_config.json              ← machine-readable config for CI/CD runners
  collection_data.yml          ← manifest registry (category → collection → data)
  pict_models/<opId>.pict      ← factor model audit trail — commit to VCS
  test_scripts/<Request>.js    ← extracted assertion scripts for code review
  pairwise_matrix.csv          ← human-readable test matrix
  validation_report.md         ← automated quality gates (0 errors = ready)
  coverage_report.md           ← coverage metrics
  gaps_report.md               ← uncovered endpoints / missing assertions
  report.md                    ← timing + token + cost summary
  structured/test_results.jsonl← per-row results — DuckDB queryable
  structured/coverage.json     ← run-level metrics
```

## Architecture

```
Orchestrator (claude-sonnet-4-6)         ← coordinates all phases
  ↓ deterministic tools
  parse_openapi → apply_naming_rules
  ↓ Pairwise Designer (claude-opus-4-8)  ← complex factor analysis (once)
  ↓ deterministic IPOG tool
  generate_pairwise_matrix
  ↓ Assertion Writer (claude-haiku-4-5)  ← bulk pm.test() generation
  ↓ deterministic tools
  assemble_collection → run_newman → validate → assemble_report
```

See [`openspec/openspec.md`](openspec/openspec.md) for the full design spec.
See [`DESIGN.md`](DESIGN.md) for the rationale.
