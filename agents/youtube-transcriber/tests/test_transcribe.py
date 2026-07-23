"""Eval 5 — the ASR adapter, driven by a stub segment iterator. No model."""

from __future__ import annotations

from dataclasses import dataclass

import pytest

from pipeline import transcribe
from pipeline.config import Config
from pipeline.state import PipelineError, TranscriptState, VideoRef


@dataclass
class FakeSeg:
    start: float
    end: float
    text: str


@dataclass
class FakeInfo:
    language: str = "en"


class FakeModel:
    """Stands in for WhisperModel. Records how it was called."""

    def __init__(self) -> None:
        self.calls: list[dict] = []

    def transcribe(self, path, **kwargs):
        self.calls.append({"path": path, **kwargs})
        return (
            iter(
                [
                    FakeSeg(0.0, 2.5, " the first thing to say "),
                    FakeSeg(2.5, 6.25, "and then the second"),
                    FakeSeg(6.25, 9.0, "   "),  # VAD boundary noise
                    FakeSeg(9.0, 12.0, "finally the third"),
                ]
            ),
            FakeInfo(),
        )


@pytest.fixture()
def state() -> TranscriptState:
    ref = VideoRef(video_id="EQuCyrwyfXU", source_url="https://youtu.be/EQuCyrwyfXU")
    return TranscriptState(ref=ref, audio_path="/tmp/EQuCyrwyfXU.opus")


def test_segments_are_contiguous_and_monotonic(state, monkeypatch) -> None:
    monkeypatch.setattr(transcribe, "load_model", lambda cfg: FakeModel())
    out = transcribe.transcribe(state, Config())

    assert [s.index for s in out.segments] == [0, 1, 2]
    assert all(s.end_s >= s.start_s for s in out.segments)
    starts = [s.start_s for s in out.segments]
    assert starts == sorted(starts)


def test_empty_segments_are_dropped_and_text_is_stripped(state, monkeypatch) -> None:
    monkeypatch.setattr(transcribe, "load_model", lambda cfg: FakeModel())
    out = transcribe.transcribe(state, Config())

    assert len(out.segments) == 3  # the whitespace-only one is gone
    assert out.segments[0].text == "the first thing to say"
    assert not any(s.text != s.text.strip() for s in out.segments)


def test_full_text_joins_every_segment(state, monkeypatch) -> None:
    monkeypatch.setattr(transcribe, "load_model", lambda cfg: FakeModel())
    out = transcribe.transcribe(state, Config())
    assert out.full_text == (
        "the first thing to say and then the second finally the third"
    )


def test_config_reaches_the_model(state, monkeypatch) -> None:
    model = FakeModel()
    monkeypatch.setattr(transcribe, "load_model", lambda cfg: model)
    cfg = Config(asr_beam_size=1, asr_language="en", asr_vad=True)
    transcribe.transcribe(state, cfg)

    call = model.calls[0]
    assert call["beam_size"] == 1
    assert call["language"] == "en"
    assert call["vad_filter"] is True


def test_auto_detect_passes_language_none(state, monkeypatch) -> None:
    model = FakeModel()
    monkeypatch.setattr(transcribe, "load_model", lambda cfg: model)
    transcribe.transcribe(state, Config(asr_language=None))
    assert model.calls[0]["language"] is None


def test_detected_language_and_model_are_recorded(state, monkeypatch) -> None:
    monkeypatch.setattr(transcribe, "load_model", lambda cfg: FakeModel())
    out = transcribe.transcribe(state, Config(asr_model="distil-large-v3"))
    assert out.language == "en"
    assert out.model == "distil-large-v3"


def test_silent_audio_is_an_error_not_an_empty_transcript(state, monkeypatch) -> None:
    class Silent(FakeModel):
        def transcribe(self, path, **kwargs):
            return iter([]), FakeInfo()

    monkeypatch.setattr(transcribe, "load_model", lambda cfg: Silent())
    with pytest.raises(PipelineError, match="no speech"):
        transcribe.transcribe(state, Config())


def test_missing_audio_is_rejected(monkeypatch) -> None:
    ref = VideoRef(video_id="EQuCyrwyfXU", source_url="https://youtu.be/EQuCyrwyfXU")
    with pytest.raises(PipelineError, match="no audio"):
        transcribe.transcribe(TranscriptState(ref=ref), Config())


def test_no_llm_client_is_imported() -> None:
    """The zero-token property, asserted rather than assumed."""
    import pipeline.transcribe as mod

    source = open(mod.__file__).read()
    for banned in ("openai", "anthropic", "groq", "langchain_", "requests.post"):
        assert banned not in source
