#!/usr/bin/env bash
# Create-or-update the tvs-stats-extractor Managed Agent control plane.
# Mirrors agent-pii-discovery/scripts/apply_control_plane.sh (single agent,
# no placeholders). Run from agents/talk-value-stats/ with an authenticated
# `ant` profile (ant auth status). Writes agent/applied.json.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
APPLIED=agent/applied.json

get() { python3 -c "import json,sys;print(json.load(open('$APPLIED')).get('$1',''))" 2>/dev/null || true; }

ENV_ID=$(get environment_id)
AGENT_ID=$(get agent_id)

if [[ -z "$ENV_ID" ]]; then
  ENV_ID=$(ant beta:environments create < agent/environment.yaml --transform id -r)
  echo "created environment $ENV_ID"
else
  ant beta:environments update --environment-id "$ENV_ID" < agent/environment.yaml > /dev/null
  echo "updated environment $ENV_ID"
fi

if [[ -z "$AGENT_ID" ]]; then
  AGENT_ID=$(cd agent && ant beta:agents create < stats-extractor.agent.yaml --transform id -r)
  echo "created agent $AGENT_ID"
else
  (cd agent && ant beta:agents update --agent-id "$AGENT_ID" < stats-extractor.agent.yaml > /dev/null)
  echo "updated agent $AGENT_ID"
fi

AGENT_VERSION=$(ant beta:agents retrieve --agent-id "$AGENT_ID" --transform version -r)

python3 - "$ENV_ID" "$AGENT_ID" "$AGENT_VERSION" <<'PY'
import json, sys
keys = ["environment_id", "agent_id", "agent_version"]
json.dump(dict(zip(keys, sys.argv[1:])), open("agent/applied.json", "w"), indent=2)
print("wrote agent/applied.json")
PY
