"""Tracing setup — dual export, and never load-bearing.

Follows the repo's established contract (job-pilot's `pipeline/telemetry.py`,
openspec/changes/add-job-pilot/design.md §Observability):

- **LangSmith** is native to LangGraph. `LANGSMITH_TRACING=true` plus
  `LANGSMITH_API_KEY` in the environment is all it takes — there is no code
  for it here, the runtime picks it up and traces every node.
- **OTel** spans fan out to both OpenObserve (`OTEL_EXPORTER_OTLP_ENDPOINT`)
  and Arize / Phoenix (`PHOENIX_COLLECTOR_ENDPOINT`). Each endpoint variable
  holds either the eve-agent form (…/api/default) or a full OTLP traces URL;
  `_traces_url` normalizes both.

The rule inherited from job-pilot: a missing, misconfigured, or unreachable
backend degrades to one logged warning. A transcript must still be written
when tracing is down.
"""

from __future__ import annotations

import logging
import os
from contextlib import contextmanager

log = logging.getLogger(__name__)

SERVICE_NAME = "youtube-transcriber"

_TRACER = None
_CONFIGURED = False


def _traces_url(base: str) -> str:
    base = base.rstrip("/")
    return base if base.endswith("/v1/traces") else base + "/v1/traces"


def _endpoints(environ) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    if environ.get("OTEL_EXPORTER_OTLP_ENDPOINT"):
        out.append(
            (
                _traces_url(environ["OTEL_EXPORTER_OTLP_ENDPOINT"]),
                environ.get("OTEL_EXPORTER_OTLP_HEADERS", ""),
            )
        )
    if environ.get("PHOENIX_COLLECTOR_ENDPOINT"):
        # PHOENIX_CLIENT_HEADERS (api_key=...) is only needed for Arize's
        # hosted service; a local Docker Phoenix ignores it.
        out.append(
            (
                _traces_url(environ["PHOENIX_COLLECTOR_ENDPOINT"]),
                environ.get("PHOENIX_CLIENT_HEADERS", ""),
            )
        )
    return out


def configure(environ=None) -> None:
    """Wire up OTel if it is configured. Safe to call more than once."""
    global _TRACER, _CONFIGURED
    if _CONFIGURED:
        return
    _CONFIGURED = True

    environ = environ if environ is not None else os.environ

    if environ.get("LANGSMITH_TRACING", "").strip().lower() in {"1", "true", "yes"}:
        # Nothing to wire — LangGraph reads the env itself. Logged so the
        # run's own output says whether it is on.
        log.info(
            "LangSmith tracing enabled (project %s)",
            environ.get("LANGSMITH_PROJECT", SERVICE_NAME),
        )

    endpoints = _endpoints(environ)
    if not endpoints:
        log.warning("telemetry: no OTLP endpoints configured — spans disabled")
        return

    try:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
            OTLPSpanExporter,
        )
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor

        # model_id is REQUIRED by Arize AX (otlp.arize.com) — its collector
        # returns 500 for spans without it (verified 2026-07-15 in
        # job-pilot). Harmless extra attribute for OpenObserve and Phoenix.
        provider = TracerProvider(
            resource=Resource.create(
                {"service.name": SERVICE_NAME, "model_id": SERVICE_NAME}
            )
        )
        for url, headers in endpoints:
            hdrs = dict(h.split("=", 1) for h in headers.split(",") if "=" in h)
            provider.add_span_processor(
                BatchSpanProcessor(OTLPSpanExporter(endpoint=url, headers=hdrs))
            )
        trace.set_tracer_provider(provider)
        _TRACER = trace.get_tracer(SERVICE_NAME)
        log.info("telemetry: exporting spans to %d endpoint(s)", len(endpoints))
    except Exception as exc:  # noqa: BLE001 - telemetry must never fail a run
        log.warning("telemetry: setup failed, spans disabled: %s", exc)


@contextmanager
def span(name: str, **attributes):
    """A span if tracing is on, a no-op if it is not."""
    if _TRACER is None:
        yield None
        return
    try:
        with _TRACER.start_as_current_span(name) as sp:
            for key, value in attributes.items():
                if value is not None:
                    sp.set_attribute(key, value)
            yield sp
    except Exception as exc:  # noqa: BLE001
        log.warning("span %s failed (%s) — the run continues", name, exc)
        yield None


def shutdown() -> None:
    """Flush pending spans without letting an export failure fail the run."""
    if _TRACER is None:
        return
    try:
        from opentelemetry import trace

        provider = trace.get_tracer_provider()
        if hasattr(provider, "force_flush"):
            provider.force_flush()
        if hasattr(provider, "shutdown"):
            provider.shutdown()
    except Exception as exc:  # noqa: BLE001
        log.warning("telemetry: flush failed: %s", exc)
