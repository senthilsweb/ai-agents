# job-pilot — build from the REPO ROOT (it needs job-scout's config for
# the owner's targets and board slugs):
#   docker build -f agents/job-pilot/Dockerfile -t ghcr.io/senthilsweb/job-pilot .
# Pure-Python deps only (fpdf2, not WeasyPrint — Correction 1), so slim
# needs no apt packages.
FROM python:3.12-slim

WORKDIR /app/agents/job-pilot

COPY agents/job-scout/config.yaml /app/agents/job-scout/config.yaml
COPY agents/job-pilot/pyproject.toml ./
COPY agents/job-pilot/pipeline ./pipeline
COPY agents/job-pilot/templates ./templates
COPY agents/job-pilot/inputs ./inputs
COPY agents/job-pilot/config.yaml agents/job-pilot/run.py ./

RUN pip install --no-cache-dir .

# Secrets and RUN_PAID_MATCH arrive as env vars at `docker run` time —
# nothing is baked into the image.
ENTRYPOINT ["python", "run.py"]
