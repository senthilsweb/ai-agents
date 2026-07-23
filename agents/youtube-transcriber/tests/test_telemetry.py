"""Telemetry: dual export when configured, a warning when not.

The load-bearing property is the negative one — tracing must never be able
to fail a run.
"""

from __future__ import annotations

import pytest

from pipeline import telemetry


@pytest.fixture(autouse=True)
def _reset():
    telemetry._CONFIGURED = False
    telemetry._TRACER = None
    yield
    telemetry._CONFIGURED = False
    telemetry._TRACER = None


def test_traces_url_accepts_both_repo_forms() -> None:
    # The eve-agent form gets the OTLP path appended...
    assert (
        telemetry._traces_url("https://telemetry.nathansweb.com/api/default")
        == "https://telemetry.nathansweb.com/api/default/v1/traces"
    )
    # ...and a full URL is left alone.
    assert (
        telemetry._traces_url("https://otlp.arize.com/v1/traces")
        == "https://otlp.arize.com/v1/traces"
    )
    assert telemetry._traces_url("https://x.example/api/default/") .endswith("/v1/traces")


def test_both_backends_are_collected() -> None:
    endpoints = telemetry._endpoints(
        {
            "OTEL_EXPORTER_OTLP_ENDPOINT": "https://telemetry.example/api/default",
            "OTEL_EXPORTER_OTLP_HEADERS": "Authorization=Basic abc",
            "PHOENIX_COLLECTOR_ENDPOINT": "https://otlp.arize.com/v1",
            "PHOENIX_CLIENT_HEADERS": "api_key=xyz,space_id=1",
        }
    )
    assert len(endpoints) == 2
    assert endpoints[0][0].endswith("/v1/traces")
    assert endpoints[1][0].endswith("/v1/traces")


def test_one_backend_configured_is_fine() -> None:
    assert len(telemetry._endpoints({"PHOENIX_COLLECTOR_ENDPOINT": "https://a/v1"})) == 1
    assert len(telemetry._endpoints({})) == 0


def test_no_config_disables_spans_without_raising(caplog) -> None:
    telemetry.configure(environ={})
    assert telemetry._TRACER is None
    with telemetry.span("node.transcribe", video_id="EQuCyrwyfXU") as sp:
        assert sp is None  # a no-op span, not a crash


def test_a_broken_backend_does_not_fail_the_run(monkeypatch, caplog) -> None:
    # An endpoint that cannot possibly resolve must still leave the agent
    # able to write a transcript.
    telemetry.configure(
        environ={"OTEL_EXPORTER_OTLP_ENDPOINT": "http://127.0.0.1:1/api/default"}
    )
    with telemetry.span("node.transcribe", video_id="EQuCyrwyfXU"):
        pass
    telemetry.shutdown()  # must not raise


def test_setup_failure_degrades_to_a_warning(monkeypatch, caplog) -> None:
    import builtins

    real_import = builtins.__import__

    def broken(name, *a, **kw):
        if name.startswith("opentelemetry"):
            raise ImportError("simulated missing exporter")
        return real_import(name, *a, **kw)

    monkeypatch.setattr(builtins, "__import__", broken)
    telemetry.configure(environ={"OTEL_EXPORTER_OTLP_ENDPOINT": "https://x/api/default"})

    assert telemetry._TRACER is None
    assert any("spans disabled" in r.message for r in caplog.records)


def test_arize_required_model_id_is_on_the_resource() -> None:
    telemetry.configure(
        environ={"PHOENIX_COLLECTOR_ENDPOINT": "http://127.0.0.1:1/v1/traces"}
    )
    from opentelemetry import trace

    resource = trace.get_tracer_provider().resource
    # Arize AX returns 500 for spans without model_id (job-pilot, 2026-07-15).
    assert resource.attributes["model_id"] == "youtube-transcriber"
    assert resource.attributes["service.name"] == "youtube-transcriber"


def test_langsmith_is_env_only_with_no_wiring_code() -> None:
    """LangGraph reads LANGSMITH_* itself; we only log that it is on."""
    import ast

    tree = ast.parse(open(telemetry.__file__).read())
    imported: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported += [a.name for a in node.names]
        elif isinstance(node, ast.ImportFrom):
            imported.append(node.module or "")
    assert not any(m.split(".")[0] == "langsmith" for m in imported)
    telemetry.configure(
        environ={"LANGSMITH_TRACING": "true", "LANGSMITH_PROJECT": "youtube-transcriber"}
    )
    # No OTLP endpoint, so no tracer — but no crash either.
    assert telemetry._TRACER is None
