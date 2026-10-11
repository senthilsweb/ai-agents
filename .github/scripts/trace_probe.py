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
print(f"header names sent: {sorted(hdrs) or 'none'}; "
      f"path ends with /v1/traces: {url.endswith('/v1/traces')}")


class Probe(OTLPSpanExporter):
    def _export(self, *a, **kw):
        r = super()._export(*a, **kw)
        print(f"phoenix export -> HTTP {r.status_code} {r.reason}; "
              f"content-type={r.headers.get('content-type')}; "
              f"body={r.text[:300]!r}")
        return r


provider = TracerProvider(resource=Resource.create(
    {"service.name": "job-pilot", "model_id": "job-pilot"}))
provider.add_span_processor(SimpleSpanProcessor(Probe(endpoint=url, headers=hdrs)))
with provider.get_tracer("job-pilot").start_as_current_span("healthcheck.trace_probe"):
    pass
provider.shutdown()
