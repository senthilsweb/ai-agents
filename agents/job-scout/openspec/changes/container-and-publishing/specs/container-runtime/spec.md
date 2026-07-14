# Spec: container runtime

## Requirement: Public runnable image
A Docker image containing the pipeline tools, templates, and a default
config SHALL be published to `ghcr.io/senthilsweb/job-scout`
(amd64 + arm64), rebuilt by a GitHub Action on every push to main that
touches `agents/job-scout/**`, authenticated only by GITHUB_TOKEN.

#### Scenario: Checkout-less run
- **WHEN** `docker run ghcr.io/senthilsweb/job-scout trends` runs on a
  machine with no repo checkout
- **THEN** it loads all boards, exports the trends parquet, and renders
  the dashboard HTML inside the container

## Requirement: Named jobs, guarded spend
The entrypoint SHALL expose named jobs (`load`, `export`, `report`,
`trends`, `match`) and pass anything else through verbatim. The `match`
job SHALL refuse to run unless `RUN_PAID_MATCH=yes` is set.

#### Scenario: Accidental paid run blocked
- **WHEN** `match` is invoked without `RUN_PAID_MATCH=yes`
- **THEN** the container prints why it refused and exits non-zero
  without any API call

## Requirement: Compose profiles against the checkout
`agents/job-scout/docker-compose.yml` SHALL gate every service behind a
profile (`trends`, `match`, `shell`), bind the agent checkout so
config/DB/exports are the repo's own, and read secrets from an optional
`.env` (same variables as `.env.example`).

#### Scenario: Nothing starts by default
- **WHEN** `docker compose up` runs with no `--profile`
- **THEN** no service starts

## Requirement: Standalone config override
Tools SHALL honor a `JOB_SCOUT_CONFIG` env var pointing at an alternate
config file; absolute paths inside that config SHALL be used as-is.

#### Scenario: Server run with mounted state
- **WHEN** a container runs with `-v /srv/js:/state -e JOB_SCOUT_CONFIG=/state/config.yaml`
  and that config uses absolute `/state/...` paths
- **THEN** the DB, exports, and logs land under `/srv/js` on the host
