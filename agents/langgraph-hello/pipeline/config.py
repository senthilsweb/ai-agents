"""Runtime configuration, read from the environment.

Tiny by design — there are no models and no secrets here (no LLM anywhere in
this agent), so the only knob is an input-size cap.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    max_input_chars: int = 10_000

    @classmethod
    def from_env(cls) -> "Config":
        raw = os.getenv("MAX_INPUT_CHARS", "").strip()
        try:
            cap = int(raw) if raw else cls.max_input_chars
        except ValueError:
            cap = cls.max_input_chars
        return cls(max_input_chars=cap)
