# LinkedIn Cover Run — 2026-07-05T02-55-18Z

**Status:** ok  ·  **Generated:** 2026-07-05T02:57:30.881Z

> Request: Create a LinkedIn cover from inputs/linkedin-article-cover-agent.md, palette=soft-blue-pink, density=balanced, size=1280x720, include GitHub repo link at bottom

## Models
| Phase | Model |
|---|---|
| Orchestrator | claude-sonnet-5 |
| Image | gpt-image-2 |

## Execution time
| Phase | Duration |
|---|---|
| Orchestrate (spec + prompt) | 2m 10s |
| Image generation | 1m 25s |
| Validation | 0s |
| Report | 0s |
| **Wall-clock total** | **2m 12s** |

_Compute-seconds (sum of phases): 215_

## Token consumption
| Phase | Input | Output | Total | Source |
|---|---:|---:|---:|---|
| orchestrate | 139002 | 4360 | 143362 | runtime |
| generate | 0 | 0 | 0 | runtime |
| validate | 0 | 0 | 0 | runtime |
| **Total** | **139002** | **4360** | **143362** | runtime |

## Token cost
| Model | Cost |
|---|---:|
| — | n/a |
| **Total** | **n/a** |

_No rate-card entry for the configured model(s); tokens recorded, cost marked n/a._

## Validation
- Canvas: 1280×720
- Title: One Judgment Call. Everything Else, a Tool.
- Palette: soft-blue-pink
- Result: passed (1280×720)

## Artifacts
- `cover.png`
- `cover-spec.json`
- `report.md`
- `summary.json`

---
<sub>Rates are estimates from the shared cost rate-card; verify against your provider. Timing is wall-clock UTC. Generated deterministically — no LLM.</sub>
