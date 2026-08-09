# Spec: talk-value-stats-container

## ADDED Requirements

### Requirement: The image wraps the agent unchanged, one-shot, secretless
A Dockerfile at `agents/talk-value-stats/` SHALL package `extract.py`,
`build.py`, `export.py`, `schema.py`, `prompts/`, and `templates/` with their
pyproject dependencies, with **no CMD**, **no baked secrets**, and **no
server**. Invocations SHALL be one-shot `docker run --rm` calls;
`ANTHROPIC_API_KEY` and `MODEL_STATS_EXTRACTOR` SHALL arrive only via
`--env-file` at run time.

#### Scenario: Extraction run
- **WHEN** the image is invoked with `python extract.py <video-id>`, an
  env-file, `TRANSCRIBER_RUNS=/data/runs` (read-only mount of the deployed
  transcriber's runs), and the repo's `db.json` bind-mounted at `/app/db.json`
- **THEN** the upsert lands directly in the git working tree file, keyed by
  videoId, with re-runs replacing rather than duplicating

#### Scenario: No secret at rest
- **WHEN** the image or a stopped container is inspected
- **THEN** no API key is present in any layer, env default, or file

### Requirement: Site builds copy out; the dist mount is never the build target
Because `build.py` deletes and recreates `dist/`, the container SHALL build
into its internal `/app/dist` and copy the result to a mounted output
directory (`/out`). `/app/dist` SHALL NOT be bind-mounted.

#### Scenario: Build run
- **WHEN** the image is invoked for a build with the host `dist/` mounted at
  `/out` and `db.json` mounted read-only
- **THEN** `/out` afterwards contains `index.html`, one `<slug>.html` per
  talk, `stats.parquet`, and `.nojekyll`

### Requirement: CI publishes the image for both amd64 and arm64
`.github/workflows/talk-value-stats-image.yml` SHALL run the agent's tests on
every push touching the agent and, on `main`, publish
`ghcr.io/senthilsweb/talk-value-stats` for `linux/amd64` and `linux/arm64`
(GITHUB_TOKEN auth, no custom secret). The youtube-transcriber image workflow
SHALL likewise gain a native arm64 build (the weights bake SHALL NOT run under
emulation) merged into one multi-arch manifest.

#### Scenario: arm64 deployment host
- **WHEN** an Apple Silicon host pulls either image after CI has run on main
- **THEN** it receives a native arm64 image with no emulation warning
