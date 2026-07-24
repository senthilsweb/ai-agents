"""The LangGraph StateGraph.

    normalize ─▶ route ─┬─ empty ─▶ echo_empty ─┐
                        └─ text  ─▶ analyze  ────┴─▶ probe ─▶ assemble ─▶ END

One conditional edge, and it earns its place (ADR 0003 §3 asks that branches be
justified): empty input takes a different, trivial path than real text, which
is exactly the kind of routing a StateGraph exists for. LangChain chain and
agent abstractions are not used, and `langchain_core` is never imported.

Each node returns a full `model_dump()`, mirroring youtube-transcriber, so the
`steps` trace accumulates without needing per-field reducers.
"""

from __future__ import annotations

import hashlib
import logging

from langgraph.graph import END, START, StateGraph

from . import probe
from .config import Config
from .state import GraphState

log = logging.getLogger(__name__)


def n_normalize(state: GraphState, cfg: Config) -> GraphState:
    state.visited("normalize")
    text = (state.text or "")[: cfg.max_input_chars]
    state.normalized = " ".join(text.split())  # collapse whitespace
    return state


def route(state: GraphState) -> str:
    """The one conditional edge: empty vs. real text."""
    return "empty" if not state.normalized else "text"


def n_echo_empty(state: GraphState, cfg: Config) -> GraphState:
    state.visited("echo_empty")
    state.stats = {"word_count": 0, "char_count": 0, "checksum": None}
    return state


def n_analyze(state: GraphState, cfg: Config) -> GraphState:
    state.visited("analyze")
    norm = state.normalized or ""
    checksum = hashlib.sha256(norm.encode("utf-8")).hexdigest()[:12]
    state.stats = {
        "word_count": len(norm.split()),
        "char_count": len(norm),
        "reversed": norm[::-1],
        "checksum": checksum,
    }
    return state


def n_probe(state: GraphState, cfg: Config) -> GraphState:
    state.visited("probe")
    state.env = probe.gather_env()
    return state


def n_assemble(state: GraphState, cfg: Config) -> GraphState:
    state.visited("assemble")
    wc = (state.stats or {}).get("word_count", 0)
    host = (state.env or {}).get("hostname", "?")
    kernel = (state.env or {}).get("kernel", "?")
    if wc:
        state.result = f"{wc} word(s) analyzed on {host} (kernel {kernel})"
    else:
        state.result = f"no input — hello from {host} (kernel {kernel})"
    return state


def build_graph(cfg: Config):
    """Compile the graph. `cfg` is bound into the nodes by closure, mirroring
    youtube-transcriber."""

    def wrap(fn):
        return lambda state: fn(state, cfg).model_dump()

    g = StateGraph(GraphState)
    g.add_node("normalize", wrap(n_normalize))
    g.add_node("echo_empty", wrap(n_echo_empty))
    g.add_node("analyze", wrap(n_analyze))
    g.add_node("probe", wrap(n_probe))
    g.add_node("assemble", wrap(n_assemble))

    g.add_edge(START, "normalize")
    g.add_conditional_edges("normalize", route, {"empty": "echo_empty", "text": "analyze"})
    g.add_edge("echo_empty", "probe")
    g.add_edge("analyze", "probe")
    g.add_edge("probe", "assemble")
    g.add_edge("assemble", END)
    return g.compile()


def run_once(text: str, cfg: Config | None = None) -> GraphState:
    """Run one input through the graph and return the validated state."""
    cfg = cfg or Config.from_env()
    result = build_graph(cfg).invoke(GraphState(text=text))
    return GraphState.model_validate(result)
