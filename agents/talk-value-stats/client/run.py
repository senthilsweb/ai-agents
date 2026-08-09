"""Drive one serverless stats session: python -m client.run <video-url-or-id>

Prereqs (see openspec/changes/deploy-stats-managed-agent):
- `ant auth login` done on this machine; ANTHROPIC_API_KEY UNSET (a set key
  outranks the OAuth profile and 404s against another workspace).
- agent/applied.json written by scripts/apply_stats_agent.sh.
- .env (or environment) with TRANSCRIBER_URL, TRANSCRIBER_API_KEY (if the
  service enforces one), and OBJECT_STORE_*.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
load_dotenv(HERE.parent / ".env")

from client.session import run_session  # noqa: E402
from client.tools import ToolState  # noqa: E402


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("usage: python -m client.run <youtube-url-or-11-char-id>")
    if os.getenv("ANTHROPIC_API_KEY"):
        sys.exit(
            "ANTHROPIC_API_KEY is set — it outranks the `ant auth login` "
            "profile and will 404 against this workspace's agents. "
            "`unset ANTHROPIC_API_KEY` and retry."
        )
    applied_path = HERE.parent / "agent" / "applied.json"
    if not applied_path.exists():
        sys.exit("agent/applied.json missing — run scripts/apply_stats_agent.sh first")
    ids = json.loads(applied_path.read_text())

    from anthropic import Anthropic

    outcome = run_session(
        Anthropic(),
        agent_id=ids["agent_id"],
        agent_version=int(ids["agent_version"]),
        environment_id=ids["environment_id"],
        video_ref=sys.argv[1],
        state=ToolState(),
    )
    print(f"\nterminal: {outcome.terminal}\n")
    print(outcome.final_text())
    print(
        "\nTo publish: infra/cmg/sync-db.sh then review "
        "`git diff agents/talk-value-stats/db.json` and push."
    )


if __name__ == "__main__":
    main()
