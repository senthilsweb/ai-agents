#!/usr/bin/env bash
# Manual/dry-check wrapper: rebuild the talk-value-stats site from the repo's
# db.json into ~/opt/cmg/talk-value-stats/dist. Same command as the
# orchestrator's build_site tool (source of truth: agents/cmg-orchestrator/core.py).
#
# build.py rmtree's /app/dist, so the host dist/ is mounted at /out and the
# result copied out — never bind-mount /app/dist itself.
set -euo pipefail

CMG_ROOT="${CMG_ROOT:-$HOME/opt/cmg}"
REPO="${REPO:?set REPO to the ai-agents monorepo path}"
STATS_IMAGE="${STATS_IMAGE:-ghcr.io/senthilsweb/talk-value-stats:latest}"
ENV_FILE="$CMG_ROOT/talk-value-stats/.env"

# Object-store mode: build.py pulls db.json from the store; only the dist
# copy-out mount remains (output, not state).
if grep -q '^OBJECT_STORE_BUCKET=..*' "$ENV_FILE" 2>/dev/null; then
  exec docker run --rm --env-file "$ENV_FILE" \
    -v "$CMG_ROOT/talk-value-stats/dist:/out" \
    "$STATS_IMAGE" \
    sh -c "python build.py && rm -rf /out/* && cp -r dist/. /out/"
fi

exec docker run --rm \
  -v "$REPO/agents/talk-value-stats/db.json:/app/db.json:ro" \
  -v "$CMG_ROOT/talk-value-stats/dist:/out" \
  "$STATS_IMAGE" \
  sh -c "python build.py && rm -rf /out/* && cp -r dist/. /out/"
