# One-shot image for talk-value-stats — no server, no CMD, no secrets baked.
# Invoked per call by the cmg orchestrator (or the infra/cmg run-*.sh wrappers):
#
#   extract:  docker run --rm --env-file <env> \
#               -v <cmg>/youtube-transcriber/runs:/data/runs:ro -e TRANSCRIBER_RUNS=/data/runs \
#               -v <repo>/agents/talk-value-stats/db.json:/app/db.json \
#               talk-value-stats python extract.py <video-id>
#   build:    docker run --rm -v <repo>/agents/talk-value-stats/db.json:/app/db.json:ro \
#               -v <cmg>/talk-value-stats/dist:/out \
#               talk-value-stats sh -c "python build.py && rm -rf /out/* && cp -r dist/. /out/"
#
# build.py rmtree's /app/dist, so /app/dist is never bind-mounted — build inside,
# copy out to /out. ANTHROPIC_API_KEY + MODEL_STATS_EXTRACTOR arrive via
# --env-file at run time only. Added by openspec change add-cmg-local-deploy.
FROM python:3.12-slim

WORKDIR /app

COPY pyproject.toml schema.py extract.py build.py export.py objstore.py ./
COPY prompts ./prompts
COPY templates ./templates

RUN pip install --no-cache-dir .
