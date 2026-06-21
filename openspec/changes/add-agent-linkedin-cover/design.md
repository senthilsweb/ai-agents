# Design

## Architecture
`input -> load/extract -> orchestrator Cover Spec -> deterministic prompt -> image provider -> deterministic dimension validation -> report`

## Model routing
- Orchestrator: capable low-cost reasoning model.
- Image renderer: strongest configured image model.
- Reviewer: optional cheap model, maximum one call.

## Loop policy
No review loop by default. One optional retry may occur only after a hard deterministic validation failure and only when explicitly enabled.

## Data artifacts
Each run stores `run-meta.json`, `cover-spec.json`, `prompt.txt`, `outputs/cover.png`, `validation.json`, `report.md`, and `summary.json`.
