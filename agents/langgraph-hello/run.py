#!/usr/bin/env python3
"""langgraph-hello CLI.

    python run.py "some text to analyze"
    python run.py            # no input → the empty-path branch

Runs one input through the LangGraph and prints the resulting state as JSON.
No network, no model, no tokens.
"""

from __future__ import annotations

import json
import sys

from pipeline.config import Config
from pipeline.graph import run_once


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    text = " ".join(argv)
    state = run_once(text, Config.from_env())
    print(json.dumps(state.model_dump(), indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
