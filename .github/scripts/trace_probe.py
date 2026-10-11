"""Send ONE real span to the Phoenix/Arize collector and print the HTTP
answer, using the same exporter, resource and headers as job-pilot
(pipeline/telemetry.py). Run inside the job-pilot image:

    docker run --rm -e PHOENIX_COLLECTOR_ENDPOINT -e PHOENIX_CLIENT_HEADERS \
      -v $PWD/.github/scripts/trace_probe.py:/p.py --entrypoint python \
      ghcr.io/senthilsweb/job-pilot:latest /p.py

Prints status, reason and the first 300 bytes of the body (a 403 body
usually says why). Header names are printed, never values.
"""
import os
import sys

from opentelemetry.exporter.otlp.proto.http.trace_exporter import \
    OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor

base = os.environ.get("PHOENIX_COLLECTOR_ENDPOINT", "").rstrip("/")
if not base:
    sys.exit("PHOENIX_COLLECTOR_ENDPOINT is empty")
url = base if base.endswith("/v1/traces") else base + "/v1/traces"
hdrs = dict(h.split("=", 1) for h in
            os.environ.get("PHOENIX_CLIENT_HEADERS", "").split(",") if "=" in h)
from urllib.parse import urlparse
_u = urlparse(url)
print(f"header names sent: {sorted(hdrs) or 'none'}")
print(f"secret value path: {urlparse(base).path or '(none)'}; "
      f"resolved path: {_u.path}; host is otlp.arize.com: "
      f"{_u.hostname == 'otlp.arize.com'}")
CANON = "https://otlp.arize.com/v1/traces"


import requests

_send = requests.Session.send


def _logged_send(self, req, **kw):      # version-independent HTTP hook
    r = _send(self, req, **kw)
    print(f"phoenix export -> HTTP {r.status_code} {r.reason}; "
          f"bytes_sent={len(req.body or b'')}; "
          f"content-type={r.headers.get('content-type')}; "
          f"body={r.text[:300]!r}")
    return r


requests.Session.send = _logged_send


def send(target, label, extra=None):
    print(f"-- {label}")
    prov = TracerProvider(resource=Resource.create(
        {"service.name": "job-pilot", "model_id": "job-pilot", **(extra or {})}))
    prov.add_span_processor(SimpleSpanProcessor(
        OTLPSpanExporter(endpoint=target, headers=hdrs)))
    with prov.get_tracer("job-pilot").start_as_current_span(
            "healthcheck.trace_probe." + label):
        pass
    prov.shutdown()


send(url, "as_configured")
# Arize AX organises spans into projects by this resource attribute; without
# it spans land in the default project. A distinct name makes them findable.
send(url, "with_project_name",
     {"openinference.project.name": "job-pilot-probe"})
if _u.hostname == "otlp.arize.com" and url != CANON:
    send(CANON, "canonical_v1_traces")
