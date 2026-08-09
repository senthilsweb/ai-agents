#!/usr/bin/env bash
# Refresh the git working-tree db.json from the object store, ready for the
# human publish (git diff → add → commit → push). Only meaningful in
# object-store mode (add-object-store-state D3): the store copy is
# authoritative; the git copy is the publish gate.
#
# Usage: sync-db.sh          Env: CMG_ROOT, REPO, STATS_IMAGE (as run-*.sh)
set -euo pipefail

CMG_ROOT="${CMG_ROOT:-$HOME/opt/cmg}"
REPO="${REPO:?set REPO to the ai-agents monorepo path}"
STATS_IMAGE="${STATS_IMAGE:-ghcr.io/senthilsweb/talk-value-stats:latest}"

docker run --rm \
  --env-file "$CMG_ROOT/talk-value-stats/.env" \
  -v "$REPO/agents/talk-value-stats/db.json:/app/db.json" \
  "$STATS_IMAGE" \
  python objstore.py pull-db /app/db.json

echo "Now review and publish:"
echo "  cd $REPO && git diff agents/talk-value-stats/db.json"
