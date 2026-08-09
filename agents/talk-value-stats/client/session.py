"""Managed Agents session driver for the tvs-stats-extractor agent.

A near-verbatim port of agent-pii-discovery's client/session.py, which
encodes three real bugs found in live sessions: consolidation on connect
(history fetch + live stream, deduped by event id), the correct terminal
gate (idle is terminal only when stop_reason is not requires_action), and
the session_thread_id echo on custom-tool results. Auth comes from the
`ant auth login` profile — ANTHROPIC_API_KEY must stay UNSET (a set key
outranks the profile and 404s against another workspace's agents).
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

from client.tools import ToolState, handle_tool_call

WORKSPACE = "default"


@dataclass
class SessionOutcome:
    session_id: str
    events: list[Any] = field(default_factory=list)
    terminal: str = "unknown"

    def final_text(self) -> str:
        for e in reversed(self.events):
            if e.type == "agent.message":
                parts = getattr(e, "content", None) or []
                texts = [getattr(p, "text", "") for p in parts]
                joined = "\n".join(t for t in texts if t)
                if joined:
                    return joined
        return ""


def run_session(
    client: Any,
    agent_id: str,
    agent_version: int,
    environment_id: str,
    video_ref: str,
    state: ToolState,
) -> SessionOutcome:
    session = client.beta.sessions.create(
        agent={"type": "agent", "id": agent_id, "version": agent_version},
        environment_id=environment_id,
        title=f"tvs {video_ref[:60]}",
        initial_events=[{
            "type": "user.message",
            "content": [{
                "type": "text",
                "text": f"Process this video into talk-value-stats: {video_ref}",
            }],
        }],
    )
    print(
        f"session {session.id} — trace: "
        f"https://platform.claude.com/workspaces/{WORKSPACE}/sessions/{session.id}"
    )

    outcome = SessionOutcome(session_id=session.id)
    seen: set[str] = set()

    def ingest(event: Any) -> None:
        if event.id in seen:
            return
        seen.add(event.id)
        outcome.events.append(event)
        if event.type == "agent.custom_tool_use":
            content, is_error = handle_tool_call(event.name, event.input or {}, state)
            reply = {
                "type": "user.custom_tool_result",
                "custom_tool_use_id": event.id,
                "content": [{"type": "text", "text": content}],
                "is_error": is_error,
            }
            thread_id = getattr(event, "session_thread_id", None)
            if thread_id:
                reply["session_thread_id"] = thread_id
            client.beta.sessions.events.send(session.id, events=[reply])

    def terminal_of(event: Any) -> str | None:
        # Checked in BOTH replay and tail: a terminal event that arrived
        # before the history fetch never re-appears on the stream.
        if event.type == "session.status_terminated":
            return "terminated"
        if event.type == "session.status_idle":
            stop_type = getattr(getattr(event, "stop_reason", None), "type", None)
            if stop_type != "requires_action":
                return stop_type or "end_turn"
        return None

    stream = client.beta.sessions.events.stream(session_id=session.id)
    terminal: str | None = None
    for event in client.beta.sessions.events.list(session_id=session.id):
        ingest(event)
        terminal = terminal or terminal_of(event)
    if terminal is None:
        for event in stream:
            ingest(event)
            terminal = terminal_of(event)
            if terminal:
                break
    outcome.terminal = terminal or "unknown"

    for _ in range(10):
        if client.beta.sessions.retrieve(session.id).status != "running":
            break
        time.sleep(0.5)
    return outcome
