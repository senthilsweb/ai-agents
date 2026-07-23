#!/usr/bin/env python3
"""youtube-transcriber — full audio transcript from a YouTube video.

    python run.py <video-id-or-url> [<video-id-or-url> ...]

Local ASR, zero LLM tokens. Videos run one at a time: transcription is
CPU-bound, so running them concurrently would only make each one slower.
A failure on one video does not stop the others.
"""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

from pipeline import telemetry, ytdlp
from pipeline.config import Config
from pipeline.graph import run_one
from pipeline.state import PipelineError

log = logging.getLogger("youtube-transcriber")


def setup_logging(cfg: Config, verbose: bool) -> Path:
    cfg.logs_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    logfile = cfg.logs_dir / f"run-{stamp}.log"

    # Logs carry video ids, durations, and error reasons — never transcript
    # text. See the transcript-output spec.
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        handlers=[logging.FileHandler(logfile), logging.StreamHandler(sys.stderr)],
    )

    # The first run downloads model weights, and huggingface_hub narrates
    # every HTTP request it makes at INFO. Left alone it buries the four
    # lines that actually describe the run.
    for noisy in ("httpx", "huggingface_hub", "urllib3", "filelock", "faster_whisper"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    return logfile


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="youtube-transcriber",
        description="Transcribe the full audio of one or more YouTube videos, locally.",
    )
    parser.add_argument("videos", nargs="+", help="video id or URL")
    parser.add_argument("--model", help="override ASR_MODEL for this run")
    parser.add_argument("--language", help="force a language instead of auto-detecting")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)

    load_dotenv()
    cfg = Config.from_env()
    if args.model:
        cfg = replace_cfg(cfg, asr_model=args.model)
    if args.language:
        cfg = replace_cfg(cfg, asr_language=args.language)

    logfile = setup_logging(cfg, args.verbose)
    telemetry.configure()

    try:
        ytdlp.ensure_available()
    except PipelineError as exc:
        # Fail before any run folder is created.
        print(f"\n{exc}\n", file=sys.stderr)
        return 2

    log.info("transcribing %d video(s) with %s", len(args.videos), cfg.asr_model)

    failures: list[tuple[str, str]] = []
    for raw in args.videos:
        try:
            state = run_one(raw, cfg)
            print(
                f"\n  {state.title or state.ref.video_id}\n"
                f"  {len(state.segments)} segments, "
                f"{len(state.full_text.split())} words"
                f"{' (cached audio)' if state.cache_hit else ''}\n"
                f"  → {state.run_dir}\n"
            )
        except PipelineError as exc:
            log.error("failed: %s — %s", raw, exc)
            failures.append((raw, str(exc)))
        except Exception as exc:  # noqa: BLE001 - one bad video must not stop the rest
            log.exception("unexpected failure on %s", raw)
            failures.append((raw, f"unexpected: {exc}"))

    telemetry.shutdown()

    if failures:
        print(f"\n{len(failures)} of {len(args.videos)} failed:", file=sys.stderr)
        for raw, reason in failures:
            print(f"  {raw}: {reason}", file=sys.stderr)
        print(f"\nlog: {logfile}", file=sys.stderr)
        return 1
    return 0


def replace_cfg(cfg: Config, **kw) -> Config:
    from dataclasses import replace

    return replace(cfg, **kw)


if __name__ == "__main__":
    raise SystemExit(main())
