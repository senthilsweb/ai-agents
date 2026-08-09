#!/usr/bin/env bash
# Manual/dry-check wrapper: run talk-value-stats extraction for one video id.
# This is the EXACT command the orchestrator's extract_stats tool runs — keep
# the two in sync (source of truth: agents/cmg-orchestrator/core.py).
#
# Usage: run-extract.sh <11-char-video-id>
# Env (defaults match install.sh): CMG_ROOT, REPO, STATS_IMAGE
set -euo pipefail

VID="${1:?usage: run-extract.sh <11-char-video-id>}"
[[ "$VID" =~ ^[A-Za-z0-9_-]{11}$ ]] || { echo "not an 11-char video id: $VID" >&2; exit 2; }

CMG_ROOT="${CMG_ROOT:-$HOME/opt/cmg}"
REPO="${REPO:?set REPO to the ai-agents monorepo path}"
STATS_IMAGE="${STATS_IMAGE:-ghcr.io/senthilsweb/talk-value-stats:latest}"
ENV_FILE="$CMG_ROOT/talk-value-stats/.env"

# Object-store mode (add-object-store-state): a bucket in the env file means
# state flows through S3/MinIO — no mounts.
if grep -q '^OBJECT_STORE_BUCKET=..*' "$ENV_FILE" 2>/dev/null; then
  exec docker run --rm --env-file "$ENV_FILE" "$STATS_IMAGE" python extract.py "$VID"
fi

exec docker run --rm \
  --env-file "$ENV_FILE" \
  -v "$CMG_ROOT/youtube-transcriber/runs:/data/runs:ro" \
  -e TRANSCRIBER_RUNS=/data/runs \
  -v "$REPO/agents/talk-value-stats/db.json:/app/db.json" \
  "$STATS_IMAGE" \
  python extract.py "$VID"
