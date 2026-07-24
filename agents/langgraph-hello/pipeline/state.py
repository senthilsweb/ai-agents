"""Typed state threaded through the graph.

Pydantic, not a bare TypedDict — the input length cap belongs on the model, and
every node returns a full `model_dump()` (mirroring youtube-transcriber), so
no per-field reducers are needed.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class GraphState(BaseModel):
    """One instance per /run request."""

    # Input.
    text: str = ""

    # Trace of node names, in visit order — makes the graph's path observable
    # (and is what the tests assert on).
    steps: list[str] = Field(default_factory=list)

    # Filled by nodes.
    normalized: str | None = None
    stats: dict | None = None       # word_count, char_count, checksum, ...
    env: dict | None = None         # the microVM/host probe
    result: str = ""

    def visited(self, node: str) -> None:
        self.steps = [*self.steps, node]
