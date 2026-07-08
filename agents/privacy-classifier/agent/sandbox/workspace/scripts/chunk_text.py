#!/usr/bin/env python3
"""Semantic chunking via Chonkie's SemanticChunker. No LLM involved — chunk
boundaries come from embedding-similarity, not a generative model call.

See https://docs.chonkie.ai/oss/chunkers/semantic-chunker

Usage: chunk_text.py <text_input_path> <json_output_path> [chunk_size] [threshold]
"""
import json
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) < 3:
        print(
            "usage: chunk_text.py <text_input_path> <json_output_path> [chunk_size] [threshold]",
            file=sys.stderr,
        )
        return 2

    text_input_path, json_output_path = sys.argv[1:3]
    chunk_size = int(sys.argv[3]) if len(sys.argv) > 3 else 800
    threshold = float(sys.argv[4]) if len(sys.argv) > 4 else 0.7

    text = Path(text_input_path).read_text(encoding="utf-8")

    from chonkie import SemanticChunker

    chunker = SemanticChunker(chunk_size=chunk_size, threshold=threshold)
    chunks = chunker.chunk(text)

    records = [
        {
            "index": i,
            "content": chunk.text,
            "tokens": chunk.token_count,
        }
        for i, chunk in enumerate(chunks)
    ]

    Path(json_output_path).write_text(
        json.dumps({"chunks": records}, indent=2), encoding="utf-8"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
