"""Graph wiring + node behaviour. No network, no secrets."""

from __future__ import annotations

from pipeline.config import Config
from pipeline.graph import route, run_once
from pipeline.state import GraphState

import run as cli


CFG = Config()


def test_text_path_visits_analyze():
    st = run_once("Hello  world  hello", CFG)
    assert st.steps == ["normalize", "analyze", "probe", "assemble"]
    assert st.normalized == "Hello world hello"
    assert st.stats["word_count"] == 3
    assert st.stats["char_count"] == len("Hello world hello")
    assert st.stats["reversed"] == "olleh dlrow olleH"
    assert len(st.stats["checksum"]) == 12
    assert "3 word(s)" in st.result


def test_empty_path_visits_echo():
    st = run_once("   ", CFG)  # whitespace collapses to empty
    assert st.steps == ["normalize", "echo_empty", "probe", "assemble"]
    assert st.stats["word_count"] == 0
    assert "no input" in st.result


def test_route_helper():
    assert route(GraphState(normalized="")) == "empty"
    assert route(GraphState(normalized="x")) == "text"


def test_probe_env_present_and_shaped():
    st = run_once("anything", CFG)
    for key in ("hostname", "kernel", "machine", "cpu_count", "pid"):
        assert key in st.env


def test_input_cap_enforced():
    st = run_once("a " * 5000, Config(max_input_chars=10))
    assert len(st.normalized) <= 10


def test_cli_runs(capsys):
    rc = cli.main(["hello", "there"])
    assert rc == 0
    out = capsys.readouterr().out
    assert '"result"' in out and "2 word(s)" in out
