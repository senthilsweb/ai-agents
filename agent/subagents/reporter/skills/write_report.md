---
description: Reporter procedure. Aggregate a run's phase traces into a report.md and summary.json with timing, token, and cost metrics. Run this when delegated the reporting phase of a run.
---

# Write Report

You are delegated the reporting phase of a run. You receive a **run_dir** (and
`allow_cost`). You aggregate the run's metrics and write the report. Inputs in
`run_dir`: `run-meta.json`, `spec.json` (optional), `phases/*.json`, and the
`cost-rates.yaml` from the `cost_rates` skill. Outputs: `<run_dir>/report.md` and
`<run_dir>/summary.json`.

## Steps

### 1 — Load everything
Read `run-meta.json`, every `phases/*.json`, and `cost-rates.yaml` (load the
`cost_rates` skill). List the artifacts present in `run_dir` (`*.html`,
`*.preview.png`).

### 2 — Compute timing
- Per phase: `duration_s` (use the trace value; if missing, derive from
  `ended_at - started_at`).
- Total wall-clock: `max(ended_at) - min(started_at)` across phases (this accounts
  for parallel renderers, unlike a naive sum). Also report the summed
  compute-seconds for reference.
- Format human-readable (e.g. `1m 12s`).

### 3 — Compute tokens
- Each phase trace should have its `tokens` block filled from the `read_usage`
  tool (captured by the usage hook from `step.completed` events).
- Sum `tokens.input`, `tokens.output`, `tokens.total` across phases where
  `tokens.source == "runtime"`.
- If a phase has `tokens.source == "unavailable"`, exclude it and note it.
- If NO phase has token data, mark tokens as `n/a` and add the note: "runtime did
  not report token usage — timing only."
- Include `cacheReadTokens` and `cacheWriteTokens` in the summary if present.

### 4 — Compute cost (only if `allow_cost` is true)
Read `cost-rates.yaml`. Use its `mode`:
- `per_token`: for each phase, `cost = input/1e6 * rate.input + output/1e6 * rate.output`,
  matching the phase's `model` (fall back to `default`; if rate is 0/default,
  mark that phase cost `n/a`). Sum for the run total.
- `per_request`: `cost = sum over phases of usd_per_premium_request * multiplier[model]`.
If `allow_cost` is false or rates are missing/zero, set cost `n/a` and say why.
Always state that rates are estimates from `cost-rates.yaml` (verify against your
provider).

### 5 — Write `summary.json` (machine-readable)
```jsonc
{
  "run_id": "...",
  "status": "ok | partial | failed",
  "models": { "orchestrator": "...", "renderer": "...", "reporter": "..." },
  "variations": ["default"],
  "timing": { "wall_s": 0, "compute_s": 0, "per_phase": { "orchestrate": 0, "render-default": 0, "report": 0 } },
  "tokens": { "input": 0, "output": 0, "total": 0, "by_phase": {}, "source": "runtime|usage-file|unavailable" },
  "cost": { "currency": "USD", "mode": "per_token", "total": 0, "by_phase": {}, "estimated": true, "note": "" },
  "qc": { "default": { "passed": true } },
  "artifacts": ["diagram.html", "diagram.preview.png", "report.md", "summary.json", "spec.json"]
}
```

### 6 — Write `report.md`
Fill the report template (the `report_template` skill) with the computed values
and save it as `<run_dir>/report.md` via `write_run_file`. Keep it clean and
scannable: a header with run id + status, a timing table, a tokens table, a cost
table (or an "n/a" line with the reason), a QC line per variation, and a linked
list of artifacts (relative paths). Do not invent numbers — if something is
unknown, print `n/a` and a one-line reason.

### 7 — Record your own phase + return
Call `read_usage` (no session_id) to get your token consumption. Append
`<run_dir>/phases/report.json` with your phase timing/model and the token counts
from your session's usage data (`"source": "runtime"`), then return
`{ report: "report.md", summary: "summary.json" }` to the orchestrator.
