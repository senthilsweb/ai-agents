# LinkedIn Cover Run — 2026-07-05T01-21-32Z

**Status:** ok  ·  **Generated:** 2026-07-05T01:23:43.201Z

> Request: Create a LinkedIn cover from inputs/article-job-scout.md, size=linkedin-article, palette=auto, density=minimal

## Models
| Phase | Model |
|---|---|
| Orchestrator | claude-sonnet-5 |
| Image | gpt-image-2 |

## Execution time
| Phase | Duration |
|---|---|
| Orchestrate (spec + prompt) | 2m 6s |
| Image generation | 1m 21s |
| Validation | 0s |
| Report | 0s |
| **Wall-clock total** | **2m 10s** |

_Compute-seconds (sum of phases): 207_

## Token consumption
| Phase | Input | Output | Total | Source |
|---|---:|---:|---:|---|
| orchestrate | 116980 | 3974 | 120954 | runtime |
| generate | 0 | 0 | 0 | runtime |
| validate | 0 | 0 | 0 | runtime |
| **Total** | **116980** | **3974** | **120954** | runtime |

## Token cost
| Model | Cost |
|---|---:|
| — | n/a |
| **Total** | **n/a** |

_No rate-card entry for the configured model(s); tokens recorded, cost marked n/a._

## Validation
- Canvas: 1280×720
- Title: I Turned My Job Search Into a Pipeline
- Palette: midnight navy and deep teal base with warm amber and electric cyan data-flow accents
- Result: passed (1280×720)

## Artifacts
- `cover.png`
- `cover-spec.json`
- `report.md`
- `summary.json`

---
<sub>Rates are estimates from the shared cost rate-card; verify against your provider. Timing is wall-clock UTC. Generated deterministically — no LLM.</sub>
