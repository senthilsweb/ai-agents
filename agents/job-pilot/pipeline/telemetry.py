"""Tracing setup.

Design: openspec/changes/add-job-pilot/design.md §Observability.
- LangSmith is native to LangGraph: LANGSMITH_TRACING=true +
  LANGSMITH_API_KEY in env is all it takes — no code here.
- OTel spans dual-export to OpenObserve and local Arize Phoenix using
  the repo's env contract. Each endpoint env var holds the FULL OTLP
  HTTP traces URL (.../v1/traces).
- Missing/broken telemetry env degrades to a logged warning, never a
  crash — the digest email must go out even if tracing is down.
"""
import logging
import os
from contextlib import contextmanager, nullcontext

log = logging.getLogger("job_pilot.telemetry")


def _traces_url(base: str) -> str:
    """Accept both the repo's eve-agent form (…/api/default) and a full
    OTLP traces URL (…/v1/traces) — the exporter needs the full one."""
    base = base.rstrip("/")
    return base if base.endswith("/v1/traces") else base + "/v1/traces"


def setup_tracer(environ=None):
    environ = environ if environ is not None else os.environ
    endpoints = []
    if environ.get("OTEL_EXPORTER_OTLP_ENDPOINT"):
        endpoints.append((_traces_url(environ["OTEL_EXPORTER_OTLP_ENDPOINT"]),
                          environ.get("OTEL_EXPORTER_OTLP_HEADERS", "")))
    if environ.get("PHOENIX_COLLECTOR_ENDPOINT"):
        # PHOENIX_CLIENT_HEADERS (api_key=...) is only needed for Arize's
        # hosted Phoenix Cloud; the local Docker Phoenix ignores it.
        endpoints.append((_traces_url(environ["PHOENIX_COLLECTOR_ENDPOINT"]),
                          environ.get("PHOENIX_CLIENT_HEADERS", "")))
    if not endpoints:
        log.warning("telemetry: no OTLP endpoints configured — spans disabled")
        return None
    try:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import \
            OTLPSpanExporter
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor

        # model_id is REQUIRED by Arize AX (otlp.arize.com) — its collector
        # returns 500 for spans without it (verified 2026-07-15). Harmless
        # extra attribute for OpenObserve / local Phoenix.
        provider = TracerProvider(
            resource=Resource.create({"service.name": "job-pilot",
                                      "model_id": "job-pilot"}))
        for url, headers in endpoints:
            hdrs = dict(h.split("=", 1) for h in headers.split(",") if "=" in h)
            provider.add_span_processor(
                BatchSpanProcessor(OTLPSpanExporter(endpoint=url, headers=hdrs)))
        trace.set_tracer_provider(provider)
        log.info("telemetry: exporting spans to %d endpoint(s)", len(endpoints))
        return trace.get_tracer("job-pilot")
    except Exception as e:
        log.warning("telemetry: setup failed, spans disabled: %s", e)
        return None


@contextmanager
def span(tracer, name: str, **attrs):
    """One span per node; a no-op when tracing is disabled."""
    if tracer is None:
        with nullcontext():
            yield None
        return
    with tracer.start_as_current_span(name) as s:
        for k, v in attrs.items():
            s.set_attribute(k, v)
        yield s


def flush():
    try:
        from opentelemetry import trace
        provider = trace.get_tracer_provider()
        if hasattr(provider, "force_flush"):
            provider.force_flush()
    except Exception as e:
        log.warning("telemetry: flush failed: %s", e)
