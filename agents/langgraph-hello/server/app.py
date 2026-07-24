"""FastAPI surface for langgraph-hello.

The graph is instant (no I/O), so unlike youtube-transcriber there is no async
job queue — `/run` executes synchronously and returns the state. `/whoami` is
the microVM proof endpoint: hit it after booting the image as a Firecracker VM
and the kernel/hostname/ip belong to the guest.

    uvicorn server.app:app --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from pydantic import BaseModel

from pipeline import probe
from pipeline.config import Config
from pipeline.graph import build_graph
from pipeline.state import GraphState

log = logging.getLogger("langgraph-hello.server")


class RunRequest(BaseModel):
    text: str = ""


class _State:
    cfg: Config
    graph = None
    ready: bool = False


state = _State()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
    )
    state.cfg = Config.from_env()
    # Compile the graph once at startup, not per request.
    state.graph = build_graph(state.cfg)
    state.ready = True
    log.info("graph compiled — ready")
    yield


app = FastAPI(title="langgraph-hello", version="0.1.0", lifespan=lifespan)


@app.get("/healthz")
def healthz() -> dict:
    return {"ready": state.ready, "graph_compiled": state.graph is not None}


@app.post("/run")
def run(req: RunRequest) -> dict:
    text = req.text[: state.cfg.max_input_chars]
    result = state.graph.invoke(GraphState(text=text))
    return GraphState.model_validate(result).model_dump()


@app.get("/whoami")
def whoami() -> dict:
    """Where am I running? Proves microVM isolation when run inside one."""
    return probe.gather_env()
