#!/usr/bin/env bash
# Install the "claude managed agents, local" (~/opt/cmg) tree for the
# youtube-transcriber -> talk-value-stats A2A pipeline.
#
#   ~/opt/cmg/youtube-transcriber/   docker-compose.yml, .env, runs/, cache/
#   ~/opt/cmg/talk-value-stats/      .env, run-extract.sh, run-build.sh, dist/
#   ~/opt/cmg/orchestrator/          .env, .venv/, run.sh
#
# Idempotent: re-running refreshes templates/scripts/venv but never overwrites
# an existing .env. Openspec change: add-cmg-local-deploy.
#
# Usage: install.sh            (CMG_ROOT defaults to ~/opt/cmg)
#        CMG_ROOT=/elsewhere install.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
CMG_ROOT="${CMG_ROOT:-$HOME/opt/cmg}"

command -v docker >/dev/null || { echo "docker is required (Docker Desktop on macOS)" >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 1; }
command -v node >/dev/null || echo "WARN: node not found — the Claude Agent SDK needs Node 18+ at runtime" >&2

echo "Installing cmg tree under $CMG_ROOT (repo: $REPO)"
mkdir -p "$CMG_ROOT/youtube-transcriber/runs" "$CMG_ROOT/youtube-transcriber/cache" \
         "$CMG_ROOT/talk-value-stats/dist" \
         "$CMG_ROOT/orchestrator"

install_env() { # install_env <example> <dest>
  if [[ -f "$2" ]]; then
    echo "  keep existing $2"
  else
    cp "$1" "$2"
    chmod 600 "$2"
    echo "  created $2  <-- fill in before first run"
  fi
}

# --- youtube-transcriber (long-running service) ---
cp "$HERE/youtube-transcriber.compose.yml" "$CMG_ROOT/youtube-transcriber/docker-compose.yml"
install_env "$HERE/env/youtube-transcriber.env.example" "$CMG_ROOT/youtube-transcriber/.env"

# --- talk-value-stats (one-shot image) ---
cp "$HERE/run-extract.sh" "$HERE/run-build.sh" "$CMG_ROOT/talk-value-stats/"
chmod +x "$CMG_ROOT/talk-value-stats/run-extract.sh" "$CMG_ROOT/talk-value-stats/run-build.sh"
install_env "$HERE/env/talk-value-stats.env.example" "$CMG_ROOT/talk-value-stats/.env"

# --- orchestrator (Claude Agent SDK app; code lives in the repo) ---
if [[ ! -f "$CMG_ROOT/orchestrator/.env" ]]; then
  sed -e "s|__CMG_ROOT__|$CMG_ROOT|" -e "s|__REPO__|$REPO|" \
    "$HERE/env/orchestrator.env.example" > "$CMG_ROOT/orchestrator/.env"
  chmod 600 "$CMG_ROOT/orchestrator/.env"
  echo "  created $CMG_ROOT/orchestrator/.env  <-- fill in before first run"
else
  echo "  keep existing $CMG_ROOT/orchestrator/.env"
fi

echo "  building orchestrator venv"
python3 -m venv "$CMG_ROOT/orchestrator/.venv"
"$CMG_ROOT/orchestrator/.venv/bin/pip" install -q --upgrade pip
"$CMG_ROOT/orchestrator/.venv/bin/pip" install -q -e "$REPO/agents/cmg-orchestrator"

cat > "$CMG_ROOT/orchestrator/run.sh" <<RUNSH
#!/usr/bin/env bash
# One prompt drives the pipeline, e.g.:
#   run.sh "transcribe https://youtu.be/<any-video-id> and add it to talk-value-stats"
set -euo pipefail
exec "$CMG_ROOT/orchestrator/.venv/bin/cmg-orchestrator" "\$@"
RUNSH
chmod +x "$CMG_ROOT/orchestrator/run.sh"

echo
echo "Done. Next steps:"
echo "  1. Fill in the .env files flagged above (API keys, models)."
echo "  2. cd $CMG_ROOT/youtube-transcriber && docker compose pull && docker compose up -d"
echo "     (local-build fallback: docker build -t ghcr.io/senthilsweb/youtube-transcriber:latest $REPO/agents/youtube-transcriber)"
echo "  3. curl -s http://localhost:8001/healthz   # expect ready:true, model_loaded:true"
echo "  4. $CMG_ROOT/orchestrator/run.sh \"transcribe <youtube-url> and add it to talk-value-stats\""
