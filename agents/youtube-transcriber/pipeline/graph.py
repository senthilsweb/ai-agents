"""The LangGraph StateGraph.

    resolve_video → audio_cached?
                       ├─ no  → fetch_audio ─┐
                       └─ yes → use_cached ──┴→ transcribe → write_outputs

One conditional edge, and it earns its place (ADR 0003 §3 requires branches
be justified): re-transcribing an already-downloaded video with a different
model is the normal iteration loop, and re-downloading an hour of audio each
time is both slow and an unnecessary hit on YouTube.

LangChain chain and agent abstractions are not used here, and
`langchain_core` is never imported.
"""

from __future__ import annotations

import logging
import time

from langgraph.graph import END, START, StateGraph

from . import audio, outputs, resolve, telemetry, transcribe
from .config import Config
from .state import TranscriptState

log = logging.getLogger(__name__)


def _timed(name: str, fn, state: TranscriptState, cfg: Config) -> TranscriptState:
    """Run a node, record its wall clock, and trace it."""
    started = time.monotonic()
    with telemetry.span(f"node.{name}", video_id=state.ref.video_id):
        out = fn(state, cfg)
    elapsed = round(time.monotonic() - started, 2)
    out.metrics = {**out.metrics, f"{name}_s": elapsed}
    log.info("%s finished in %.2fs", name, elapsed)
    return out


def build_graph(cfg: Config):
    """Compile the graph. `cfg` is bound into the nodes by closure."""

    def n_resolve(state: TranscriptState) -> dict:
        return _timed("resolve", resolve.resolve_video, state, cfg).model_dump()

    def n_fetch(state: TranscriptState) -> dict:
        return _timed("fetch_audio", audio.fetch_audio, state, cfg).model_dump()

    def n_cached(state: TranscriptState) -> dict:
        return _timed("use_cached", audio.use_cached_audio, state, cfg).model_dump()

    def n_transcribe(state: TranscriptState) -> dict:
        return _timed("transcribe", transcribe.transcribe, state, cfg).model_dump()

    def n_write(state: TranscriptState) -> dict:
        return _timed("write_outputs", outputs.write_outputs, state, cfg).model_dump()

    def audio_cached(state: TranscriptState) -> str:
        return "cached" if audio.has_cached_audio(state.ref, cfg) else "download"

    graph = StateGraph(TranscriptState)
    graph.add_node("resolve_video", n_resolve)
    graph.add_node("fetch_audio", n_fetch)
    graph.add_node("use_cached_audio", n_cached)
    graph.add_node("transcribe", n_transcribe)
    graph.add_node("write_outputs", n_write)

    graph.add_edge(START, "resolve_video")
    graph.add_conditional_edges(
        "resolve_video",
        audio_cached,
        {"cached": "use_cached_audio", "download": "fetch_audio"},
    )
    graph.add_edge("fetch_audio", "transcribe")
    graph.add_edge("use_cached_audio", "transcribe")
    graph.add_edge("transcribe", "write_outputs")
    graph.add_edge("write_outputs", END)

    return graph.compile()


def run_one(raw_input: str, cfg: Config) -> TranscriptState:
    """Resolve one input and run it through the graph. May raise PipelineError."""
    ref = resolve.parse_video_ref(raw_input)
    state = TranscriptState(ref=ref)

    with telemetry.span(
        "transcribe_video", video_id=ref.video_id, source=raw_input[:200]
    ):
        result = build_graph(cfg).invoke(state)

    # LangGraph hands back a dict-like; re-validate so callers get the model.
    return TranscriptState.model_validate(result)
