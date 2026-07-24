# Tasks: add-langgraph-hello

## Bolt 1 — the agent

- [x] `pipeline/` — `state.py` (pydantic `GraphState`), `config.py`
      (`MAX_INPUT_CHARS`), `probe.py` (env probe), `graph.py` (StateGraph, one
      conditional edge).
- [x] `run.py` — CLI.
- [x] `server/app.py` — `GET /healthz`, `POST /run`, `GET /whoami`.
- [x] `pyproject.toml` (langgraph, fastapi, uvicorn; dev: pytest, httpx;
      `pythonpath=["."]`), `.gitignore`, `README.md`.

## Bolt 2 — tests + container

- [x] `tests/test_graph.py` + `tests/test_server.py` — node behaviour, both
      branches, probe shape, CLI, HTTP surface. No network, no secrets.
- [x] `Dockerfile` — slim + `pip install .` + uvicorn; ~200 MB, no weights.

## Bolt 3 — CI + docs

- [x] `.github/workflows/langgraph-hello-image.yml` — tests on push, GHCR image
      on `main` (mirrors the other agents; `GITHUB_TOKEN`, no custom secret).
- [x] Root `AGENTS.md` entry.

## Verification

- [x] `.venv/bin/pytest -q` green (10 passed, bare invocation as CI runs it).
- [x] CLI + live uvicorn smoke locally (`/healthz`, `/run`, `/whoami`).
- [x] **microVM boot — VERIFIED** 2026-07-24 on Intel bare metal (Vultr,
      Ubuntu 24.04, native `/dev/kvm`). Booted via the generic
      `infra/firecracker/` tooling with defaults; `GET /whoami` → guest kernel
      `5.10.233` vs host `6.8.0-136-generic` (different kernel = real microVM),
      `containerized:false`; `POST /run` executed the graph inside the VM.
      Surfaced + fixed three infra defects (old 4.14 kernel → getrandom hang;
      missing entropy device; stray `/.dockerenv`) in commit a5667df, then
      re-verified with committed defaults.
