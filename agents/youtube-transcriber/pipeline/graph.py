"""The LangGraph StateGraph.

    resolve_video → audio_cached?
                       ├─ no  → fetch_audio ─┐
                       └─ yes → use_cached ──┴→ transcribe → write_outputs
                                                                │
                                              store_configured? ├─ no → END
                                                                └─ yes → upload_artifacts → END

Two conditional edges, each earning its place (ADR 0003 §3 requires branches
be justified): re-transcribing an already-downloaded video with a different
model is the normal iteration loop, and re-downloading an hour of audio each
time is both slow and an unnecessary hit on YouTube; the object-store mirror
(add-object-store-state) only exists when OBJECT_STORE_* is configured, so
the default pipeline shape is unchanged.

LangChain chain and agent abstractions are not used here, and
`langchain_core` is never imported.
"""

from __future__ import annotations

import logging
import time
from pathlib import Path

from langgraph.graph import END, START, StateGraph

from . import audio, objectstore, outputs, resolve, telemetry, transcribe
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

    def n_upload(state: TranscriptState) -> dict:
        # Mirror failure is a warning, not a run failure: the transcript
        # already exists locally (add-object-store-state design D1).
        def upload(s: TranscriptState, _cfg: Config) -> TranscriptState:
            store = objectstore.ObjectStoreConfig.from_env()
            try:
                objectstore.upload_run_dir(Path(s.run_dir), store)
            except Exception as exc:
                log.warning("object-store upload failed: %s", exc)
                s.metrics = {**s.metrics, "upload_error": str(exc)}
            return s

        return _timed("upload_artifacts", upload, state, cfg).model_dump()

    def audio_cached(state: TranscriptState) -> str:
        return "cached" if audio.has_cached_audio(state.ref, cfg) else "download"

    def store_configured(state: TranscriptState) -> str:
        return "upload" if objectstore.ObjectStoreConfig.from_env() else "done"

    graph = StateGraph(TranscriptState)
    graph.add_node("resolve_video", n_resolve)
    graph.add_node("fetch_audio", n_fetch)
    graph.add_node("use_cached_audio", n_cached)
    graph.add_node("transcribe", n_transcribe)
    graph.add_node("write_outputs", n_write)
    graph.add_node("upload_artifacts", n_upload)

    graph.add_edge(START, "resolve_video")
    graph.add_conditional_edges(
        "resolve_video",
        audio_cached,
        {"cached": "use_cached_audio", "download": "fetch_audio"},
    )
    graph.add_edge("fetch_audio", "transcribe")
    graph.add_edge("use_cached_audio", "transcribe")
    graph.add_edge("transcribe", "write_outputs")
    # Second conditional edge (justified per ADR 0003 §3, same as the audio
    # cache): mirroring artifacts to the object store only happens when
    # OBJECT_STORE_* is configured — the default pipeline shape is unchanged.
    graph.add_conditional_edges(
        "write_outputs",
        store_configured,
        {"upload": "upload_artifacts", "done": END},
    )
    graph.add_edge("upload_artifacts", END)

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
