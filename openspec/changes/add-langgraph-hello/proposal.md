# Proposal: langgraph-hello — a tiny LangGraph example + Firecracker smoke test

> Status: **IMPLEMENTED** — drafted & built 2026-07-24. Owner: @senthilsweb.
> Use case: **Prove the Firecracker microVM path with a small, self-contained agent.**

## Why

The `add-youtube-transcriber-service` change added a Firecracker microVM
deployment path (`infra/firecracker/`), but that path was never actually
booted: the only available host (Hetzner Cloud, `5.75.250.223`) has no
`/dev/kvm`, so Firecracker cannot run there, and separately YouTube bot-blocks
the datacenter IP so the transcriber can't even fetch audio there. The
transcriber is also a heavy test vehicle — a ~2.5 GB image (baked Whisper
weights) and an external dependency that fights datacenter IPs.

What the microVM path needs to be validated is a **small, self-contained
agent**: no network, no model weights, no API key — so it builds tiny, boots
fast, and fails for no external reason. That is this agent.

## What changes

One new agent, `agents/langgraph-hello/`, a **LangGraph** `StateGraph` (ADR
0003 — no LangChain chains, `langchain_core` never imported) with a single
small graph:

```
normalize ─▶ route ─┬─ empty ─▶ echo_empty ─┐
                    └─ text  ─▶ analyze  ────┴─▶ probe ─▶ assemble ─▶ END
```

- One **conditional edge** (empty vs. real text) justifies using a graph.
- A **`probe` node** reports the running environment — guest kernel, hostname,
  eth0 IP, PID, uptime. Inside a Firecracker microVM these are the *guest's*
  values, so the agent's own output is the smoke test's evidence of isolation.
- **REST + CLI** mirroring youtube-transcriber's shape: `run.py` and
  `server/app.py` (`GET /healthz`, `POST /run`, `GET /whoami`). The graph is
  instant, so `/run` is synchronous — no async job queue.

There is **no LLM anywhere** — same zero-token property as job-pilot and
youtube-transcriber — so evals are plain pytest.

## Impact

- New: `agents/langgraph-hello/` (pipeline, server, run.py, tests, Dockerfile,
  README), an `AGENTS.md` entry, and a CI image workflow (mirrors the other
  agents). Reuses the existing generic `infra/firecracker/` tooling unchanged.
- Unchanged: every other agent. This one stands alone.
- Prerequisites: none for build/CLI beyond Python + the pip deps. The microVM
  boot needs a KVM-capable host (`/dev/kvm`) — deferred, see design.
- Privacy/legal: none — it processes only the caller's own input text and
  reports non-sensitive host facts.
