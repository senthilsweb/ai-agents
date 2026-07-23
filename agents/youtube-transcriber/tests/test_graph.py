"""Eval 7 (graph wiring, both branches) and eval 8 (multi-video isolation).

Every node is mocked — this exercises the wiring, not the work.
"""

from __future__ import annotations

from pathlib import Path

import pytest

import run as cli
from pipeline import audio, graph, outputs, resolve, transcribe
from pipeline.config import Config
from pipeline.state import PipelineError, Segment, TranscriptState, VideoRef

SEED_A = "EQuCyrwyfXU"
SEED_B = "gYAqupu6iNI"


@pytest.fixture()
def cfg(tmp_path: Path) -> Config:
    return Config(runs_dir=tmp_path / "runs", cache_dir=tmp_path / "cache")


@pytest.fixture()
def visited(monkeypatch) -> list[str]:
    """Replace every node with a recorder."""
    order: list[str] = []

    def node(name, mutate=None):
        def fn(state: TranscriptState, cfg: Config) -> TranscriptState:
            order.append(name)
            if mutate:
                mutate(state)
            return state

        return fn

    monkeypatch.setattr(resolve, "resolve_video", node("resolve_video"))
    monkeypatch.setattr(
        audio,
        "fetch_audio",
        node("fetch_audio", lambda s: setattr(s, "audio_path", "/tmp/a.opus")),
    )
    monkeypatch.setattr(
        audio,
        "use_cached_audio",
        node("use_cached_audio", lambda s: setattr(s, "cache_hit", True)),
    )

    def _transcribed(s: TranscriptState) -> None:
        s.segments = [Segment(index=0, start_s=0.0, end_s=1.0, text="hello")]
        s.full_text = "hello"

    monkeypatch.setattr(transcribe, "transcribe", node("transcribe", _transcribed))
    monkeypatch.setattr(
        outputs,
        "write_outputs",
        node("write_outputs", lambda s: setattr(s, "run_dir", "/tmp/run")),
    )
    return order


def test_cold_run_downloads(visited, cfg, monkeypatch) -> None:
    monkeypatch.setattr(audio, "has_cached_audio", lambda ref, cfg: False)

    state = graph.run_one(f"https://www.youtube.com/watch?v={SEED_A}&t=19s", cfg)

    assert visited == [
        "resolve_video",
        "fetch_audio",
        "transcribe",
        "write_outputs",
    ]
    assert state.ref.video_id == SEED_A


def test_warm_run_skips_download_and_normalize(visited, cfg, monkeypatch) -> None:
    monkeypatch.setattr(audio, "has_cached_audio", lambda ref, cfg: True)

    state = graph.run_one(SEED_A, cfg)

    assert visited == [
        "resolve_video",
        "use_cached_audio",
        "transcribe",
        "write_outputs",
    ]
    assert "fetch_audio" not in visited
    assert state.cache_hit is True


def test_every_node_records_its_wall_clock(visited, cfg, monkeypatch) -> None:
    monkeypatch.setattr(audio, "has_cached_audio", lambda ref, cfg: True)
    state = graph.run_one(SEED_A, cfg)

    for key in ("resolve_s", "use_cached_s", "transcribe_s", "write_outputs_s"):
        assert key in state.metrics, key


def test_a_node_failure_propagates_to_the_caller(visited, cfg, monkeypatch) -> None:
    monkeypatch.setattr(audio, "has_cached_audio", lambda ref, cfg: False)

    def boom(state, cfg):
        raise PipelineError("video unavailable")

    monkeypatch.setattr(audio, "fetch_audio", boom)

    with pytest.raises(PipelineError, match="video unavailable"):
        graph.run_one(SEED_A, cfg)


def test_bad_input_never_reaches_the_graph(cfg, monkeypatch) -> None:
    def _boom(*_a, **_kw):  # pragma: no cover
        raise AssertionError("graph must not be built for invalid input")

    monkeypatch.setattr(graph, "build_graph", _boom)
    with pytest.raises(PipelineError):
        graph.run_one("https://evil.example.com/watch?v=EQuCyrwyfXU", cfg)


def test_langchain_is_not_imported_anywhere() -> None:
    """ADR 0003: LangGraph yes, LangChain chains no.

    Checks import statements, not prose — the modules are allowed to
    explain in a docstring why langchain is absent.
    """
    import ast

    pipeline_dir = Path(graph.__file__).parent
    for path in list(pipeline_dir.glob("*.py")) + [Path(cli.__file__)]:
        for node in ast.walk(ast.parse(path.read_text())):
            names: list[str] = []
            if isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom):
                names = [node.module or ""]
            assert not any(
                n.split(".")[0] in ("langchain", "langchain_core")
                for n in names
            ), f"{path.name} imports langchain"


# --- CLI: multi-video failure isolation --------------------------------


def _stub_state(video_id: str) -> TranscriptState:
    return TranscriptState(
        ref=VideoRef(video_id=video_id, source_url=f"https://youtu.be/{video_id}"),
        title=f"video {video_id}",
        full_text="hello",
        segments=[Segment(index=0, start_s=0.0, end_s=1.0, text="hello")],
        run_dir=f"/tmp/{video_id}",
    )


def test_second_video_still_runs_when_the_first_fails(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("MAX_DURATION_MIN", "180")
    monkeypatch.setattr(cli.ytdlp, "ensure_available", lambda: None)
    monkeypatch.setattr(cli, "setup_logging", lambda cfg, verbose: tmp_path / "x.log")

    processed: list[str] = []

    def fake_run_one(raw: str, cfg):
        processed.append(raw)
        if raw == SEED_A:
            raise PipelineError("download failed after 3 attempts")
        return _stub_state(SEED_B)

    monkeypatch.setattr(cli, "run_one", fake_run_one)

    code = cli.main([SEED_A, SEED_B])

    assert processed == [SEED_A, SEED_B]  # the failure did not stop the run
    assert code == 1  # but the exit code reports it


def test_all_good_exits_zero(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(cli.ytdlp, "ensure_available", lambda: None)
    monkeypatch.setattr(cli, "setup_logging", lambda cfg, verbose: tmp_path / "x.log")
    monkeypatch.setattr(cli, "run_one", lambda raw, cfg: _stub_state(SEED_B))

    assert cli.main([SEED_A, SEED_B]) == 0


def test_missing_prerequisites_stop_before_any_run_folder(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(cli, "setup_logging", lambda cfg, verbose: tmp_path / "x.log")

    def missing():
        raise PipelineError("missing prerequisites:\n  ffmpeg  →  brew install ffmpeg")

    monkeypatch.setattr(cli.ytdlp, "ensure_available", missing)

    def _boom(*_a, **_kw):  # pragma: no cover
        raise AssertionError("nothing should run without prerequisites")

    monkeypatch.setattr(cli, "run_one", _boom)

    assert cli.main([SEED_A]) == 2


def test_telemetry_absence_does_not_break_a_run(visited, cfg, monkeypatch) -> None:
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)
    monkeypatch.setattr(audio, "has_cached_audio", lambda ref, cfg: True)

    from pipeline import telemetry

    telemetry._CONFIGURED = False
    telemetry._TRACER = None
    telemetry.configure()

    state = graph.run_one(SEED_A, cfg)
    assert state.full_text == "hello"
