# Design: container-and-publishing

## D1 — Image contents and entrypoint jobs
`python:3.12-slim` + `duckdb pyyaml certifi jinja2 python-dotenv`
(the full runtime surface of tools/ — no marimo, no pandas; the
notebook stays a local dev surface). Baked in: `tools/`, `templates/`,
`config.yaml` (a working default; runtime mounts override it),
`docker/entrypoint.sh`. Jobs are named, not free-form:
- `load`    → `raw_load.py` (fetch all boards into ats_posting_raw)
- `export`  → `raw_load.py --export`
- `report`  → `build_trends_report.py` against the newest export
- `trends`  → load + export + report (the daily/typical job)
- `match`   → `daily_match.py` — **paid**; refuses unless
  `RUN_PAID_MATCH=yes` (echoes why and exits 2 otherwise). This encodes
  the standing "never run the LLM matcher unprompted" rule in the
  runtime itself, not just in habit.
Anything else passed to the entrypoint runs verbatim (`bash`,
`python tools/x.py …`), so the image doubles as a toolbox.

## D2 — Config override, not path surgery
Tools resolve everything from `ROOT / config.yaml` (code dir). Rather
than re-plumb every path, `match_sweep._cfg()` and
`build_trends_report` honor a `JOB_SCOUT_CONFIG` env var. Because
config paths are joined with `ROOT /` via pathlib, absolute paths in a
mounted config win automatically — so a standalone server run is:
mount a config with absolute `/state/...` paths, set
`JOB_SCOUT_CONFIG=/state/config.yaml`, mount `/state`. The compose
checkout mode doesn't need any of this (it binds the repo dir over
`/app`, shadowing baked code with identical checkout code — deps come
from the image, state lives in the checkout, zero path translation).

## D3 — Compose profiles
`agents/job-scout/docker-compose.yml` (agent-local; the repo-root
compose stays observability-only). All services `profiles`-gated so a
bare `docker compose up` starts nothing by accident:
- `trends`: the full facts pipeline (safe, free, idempotent)
- `match`:  daily_match; needs `.env` + `RUN_PAID_MATCH=yes` in the
  service environment — visible in the file, deliberate to enable
- `shell`:  interactive bash for ad-hoc tool runs
`env_file: [{path: .env, required: false}]` — same vars as
`.env.example` (ANTHROPIC_API_KEY, RAINFOCUS_PROFILE_ID,
RAINFOCUS_COOKIE); absence is fine for the trends profile which needs
no secrets.

## D4 — Image publish workflow
Root `.github/workflows/job-scout-image.yml`: push to main filtered on
`agents/job-scout/**` + workflow_dispatch; `permissions: packages:
write`; QEMU + buildx; platforms `linux/amd64,linux/arm64` (owner's
Macs are arm64, CI/servers amd64); `docker/metadata-action` tags:
`latest`, `sha-<short>`, `YYYYMMDD`. Auth is the default GITHUB_TOKEN.
GHCR packages start **private** on first push — making
`ghcr.io/senthilsweb/job-scout` public is a one-time manual flip in
package settings (documented in README/tasks; a workflow cannot do it).

## D5 — Help slide-over replaces inline method notes
A `help-circle` icon button (inline SVG path from lucide — MIT
licensed, no CDN) sits in the dashboard header. Click opens `#help`, a
right slide-over reusing the existing shade/drawer pattern (same
transition, ESC/shade/✕ close whichever panel is open). Content = the
method notes rewritten as short bullets under six mini-headings
(Source, Categories, Salary, Target matching, Caveats, JDs) — no
paragraphs. The `<details class="method">` block and the long footer
note go away; the footer keeps one line pointing at the public data.

## D6 — Tag-based publishing, one canonical file
`data/ats_raw_trends.parquet` is the only file: overwritten daily,
stable raw URL, no `_latest` suffix, no dated duplicates, no prune
loop. Time travel is a ref, not a filename: the workflow tags each
publish `trends/YYYYMMDD` (lightweight; skipped if the tag exists,
e.g. a manual re-dispatch), so
`raw.githubusercontent.com/…/trends/20260714/agents/job-scout/data/ats_raw_trends.parquet`
serves that day's snapshot forever. Wins: half the stored bytes per
day, three workflow steps deleted, consumers never chase filenames.
Git history remains a second, tag-free access path (any commit sha).
Migration: `git rm` the dated + `_latest` files, add the canonical
one, retag today. Local `exports/` keeps dated names (useful when
comparing local builds; gitignored anyway).

## D7 — Daily trends workflow stays pip-based
Deliberately NOT switched to `container: ghcr.io/...`: the data
refresh must not fail because an image build broke. Two dependency
declarations (4 pip packages in the workflow, same 5 in the
Dockerfile) is an acceptable cost for decoupled failure domains.
