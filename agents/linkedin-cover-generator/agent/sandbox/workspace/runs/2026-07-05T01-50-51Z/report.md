# LinkedIn Cover Run — 2026-07-05T01-50-51Z

**Status:** ok  ·  **Generated:** 2026-07-05T01:53:04.992Z

> Request: Create a LinkedIn cover (1280x720) from inputs/article-job-scout.md, palette=warm-coral-amber, density=balanced, including GitHub repo link https://github.com/senthilsweb/ai-agents at bottom of image

## Models
| Phase | Model |
|---|---|
| Orchestrator | claude-sonnet-5 |
| Image | gpt-image-2 |

## Execution time
| Phase | Duration |
|---|---|
| Orchestrate (spec + prompt) | 2m 11s |
| Image generation | 1m 27s |
| Validation | 0s |
| Report | 0s |
| **Wall-clock total** | **2m 14s** |

_Compute-seconds (sum of phases): 218_

## Token consumption
| Phase | Input | Output | Total | Source |
|---|---:|---:|---:|---|
| orchestrate | 117998 | 4447 | 122445 | runtime |
| generate | 0 | 0 | 0 | runtime |
| validate | 0 | 0 | 0 | runtime |
| **Total** | **117998** | **4447** | **122445** | runtime |

## Token cost
| Model | Cost |
|---|---:|
| — | n/a |
| **Total** | **n/a** |

_No rate-card entry for the configured model(s); tokens recorded, cost marked n/a._

## Validation
- Canvas: 1280×720
- Title: Job Hunting Is a Data Pipeline
- Palette: warm-coral-amber
- Result: passed (1280×720)

## Artifacts
- `cover.png`
- `cover-spec.json`
- `report.md`
- `summary.json`

---
<sub>Rates are estimates from the shared cost rate-card; verify against your provider. Timing is wall-clock UTC. Generated deterministically — no LLM.</sub>
