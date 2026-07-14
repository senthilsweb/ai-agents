# Installation

At the end you will have a working way to run the pipeline: the public
Docker image (no install at all), docker compose against a checkout, or
a local Python environment. You only need one of the three.

## Option A — Docker image (nothing to install)

A public image carries the tools, templates, and a default
configuration. It is rebuilt automatically on every push that touches
the agent.

```bash
docker pull ghcr.io/senthilsweb/job-scout
docker run --rm ghcr.io/senthilsweb/job-scout trends
```

Named jobs the image understands:

| Job | What it does | Cost |
|---|---|---|
| `load` | fetch every configured board into `ats_posting_raw` | free |
| `export` | write the trends + full parquet snapshots to `exports/` | free |
| `report` | render the dashboard from the newest export | free |
| `trends` | `load` + `export` + `report` in one go | free |
| `match` | the resume match sweep — **paid**, refuses to run unless `RUN_PAID_MATCH=yes` is set | paid |

Anything else is executed as a command (`bash`, `python tools/... `),
so the image doubles as a toolbox.

To run against your own state on a server, mount a folder and point
`JOB_SCOUT_CONFIG` at a config file that uses absolute paths:

```bash
docker run --rm -v /srv/js:/state -e JOB_SCOUT_CONFIG=/state/config.yaml \
    ghcr.io/senthilsweb/job-scout trends
```

## Option B — docker compose (image + your checkout)

From `agents/job-scout/` in a repo checkout. The image supplies Python
and dependencies; the checkout supplies code, `config.yaml`, the DuckDB
file, and `exports/`.

```bash
docker compose --profile trends up          # boards -> parquet -> dashboard
docker compose --profile match up           # PAID match (reads ./.env)
docker compose --profile shell run --rm shell   # interactive bash
```

Every service sits behind a profile, so a bare `docker compose up`
starts nothing by accident. The full environment-variable contract is
listed at the top of
[docker-compose.yml](https://github.com/senthilsweb/ai-agents/blob/main/agents/job-scout/docker-compose.yml)
and explained in [Configuration](configuration.md#environment-variables).

## Option C — local Python (for the notebook and development)

```bash
cd agents/job-scout
pip install marimo duckdb pyyaml pandas python-dotenv anthropic certifi
marimo edit notebook.py
```

`certifi` matters on macOS: without it, Python often has no TLS root
certificates and every board fetch fails silently. The tools load it
automatically when installed.

The command-line tools need only a subset:

```bash
pip install duckdb pyyaml certifi jinja2
python tools/raw_load.py --stats
```

## Secrets (`.env`)

Copy the template and fill in what you use. Nothing here is needed for
the free trends pipeline.

```bash
cp .env.example .env
```

| Variable | Needed for |
|---|---|
| `ANTHROPIC_API_KEY` | the notebook's optional agentic search mode |
| `RAINFOCUS_PROFILE_ID`, `RAINFOCUS_COOKIE` | loading conference sponsor catalogs |
| `JOBMATCH_API_BASE`, `JOBMATCH_AGENT_BASE` | pointing the paid matcher at a different deployment |

`.env` is git-ignored. Never put secrets in `config.yaml` or any
committed file.

## Notes

- The marimo notebook is **not** in the Docker image — it is an
  interactive, local surface. Use Option C for it.
- The image is built for amd64 and arm64 (Apple Silicon runs it
  natively).
- If `docker pull` says the package is not found, the GHCR package may
  still be private — it must be flipped to public once in GitHub
  package settings.

Next: [Configuration](configuration.md).
