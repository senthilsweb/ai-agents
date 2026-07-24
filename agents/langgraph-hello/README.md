# langgraph-hello

A deliberately tiny **LangGraph** `StateGraph` agent (ADR 0003 — no LangChain
chains). It does one small, deterministic thing: normalize some text, branch on
whether it was empty, compute a few stats, and probe its own environment. There
is **no LLM, no network, no model weights, and no API key** anywhere.

Its second job is to be a **clean Firecracker microVM smoke test**: because the
image is tiny and self-contained, it builds and boots fast, and the `probe` node
/ `GET /whoami` report the guest kernel, hostname, and eth0 IP — which *prove*
the code is running inside an isolated microVM.

## The graph

```
normalize ─▶ route ─┬─ empty ─▶ echo_empty ─┐
                    └─ text  ─▶ analyze  ────┴─▶ probe ─▶ assemble ─▶ END
```

One conditional edge (empty vs. real text) justifies using a graph.

## Layout

- `pipeline/` — `state.py` (pydantic state), `config.py` (one env knob:
  `MAX_INPUT_CHARS`), `probe.py` (the microVM/host probe), `graph.py` (the
  StateGraph).
- `run.py` — CLI: `python run.py "some text"`.
- `server/app.py` — FastAPI: `GET /healthz`, `POST /run`, `GET /whoami`.
- `tests/` — pytest, no network, no secrets.
- `Dockerfile` — `python:3.12-slim` + `pip install .`, ~200 MB.

## Run

```bash
# CLI
python run.py "hello world"

# service
uvicorn server.app:app --port 8000
curl -s localhost:8000/whoami
curl -s -XPOST localhost:8000/run -H 'content-type: application/json' \
     -d '{"text":"hello world"}'
```

## As a Firecracker microVM

Needs a KVM-capable host (`/dev/kvm`). Build the image, then use the generic
tooling in `infra/firecracker/`:

```bash
sudo infra/firecracker/build-rootfs.sh langgraph-hello /opt/firecracker/lgh.ext4 1024
sudo ROOTFS=/opt/firecracker/lgh.ext4 infra/firecracker/boot.sh
curl http://172.16.0.2:8000/whoami    # kernel/hostname/ip are the guest's
```

## Governance

`openspec/changes/add-langgraph-hello/` (repo root) — the design spec.
