"""Turn whatever the user typed into a validated VideoRef.

This is the agent's only untrusted-input boundary. Everything downstream —
subprocess arguments, cache filenames, run directory names — is built from
the 11-character video id this module produces, and from nothing else.
"""

from __future__ import annotations

import logging
from urllib.parse import parse_qs, urlparse

from .config import Config
from .state import VIDEO_ID_RE, PipelineError, TranscriptState, VideoRef

log = logging.getLogger(__name__)

# Only these hosts. Without an allowlist this becomes a general-purpose
# downloader pointed at arbitrary URLs.
ALLOWED_HOSTS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
    "www.youtu.be",
}

# Path shapes that carry the id as the final segment.
PATH_PREFIXES = ("/live/", "/shorts/", "/embed/", "/v/")


def parse_video_ref(raw: str) -> VideoRef:
    """Parse a bare id, a watch URL, a youtu.be link, or a /live//shorts/ URL.

    Every query parameter other than `v` is discarded. Real links carry
    tracking junk (`&t=19s&pp=...`), and none of it has any business
    reaching a subprocess argument or a filesystem path.
    """
    text = (raw or "").strip()
    if not text:
        raise PipelineError("empty input: expected a YouTube video id or URL")

    # A bare id, typed or pasted.
    if VIDEO_ID_RE.match(text):
        return VideoRef(
            video_id=text,
            source_url=f"https://www.youtube.com/watch?v={text}",
        )

    candidate = text if "//" in text else f"https://{text}"
    parsed = urlparse(candidate)

    host = (parsed.hostname or "").lower()
    if host not in ALLOWED_HOSTS:
        raise PipelineError(
            f"not a YouTube URL: {raw!r} (host {host or 'missing'!r} is not allowed)"
        )

    video_id: str | None = None

    if parsed.path in ("/watch", "/watch/"):
        values = parse_qs(parsed.query).get("v", [])
        video_id = values[0] if values else None
    elif host.endswith("youtu.be"):
        video_id = parsed.path.lstrip("/").split("/")[0] or None
    else:
        for prefix in PATH_PREFIXES:
            if parsed.path.startswith(prefix):
                video_id = parsed.path[len(prefix) :].split("/")[0] or None
                break

    if not video_id:
        raise PipelineError(f"could not find a video id in {raw!r}")

    if not VIDEO_ID_RE.match(video_id):
        # Catches path traversal, shell metacharacters, and truncated ids in
        # one place — the id either matches the alphabet and length, or the
        # run stops here.
        raise PipelineError(f"invalid video id {video_id!r} in {raw!r}")

    return VideoRef(video_id=video_id, source_url=text)


def ensure_within_duration(duration_s: float | None, cfg: Config) -> None:
    """Reject over-long videos before a single byte is downloaded."""
    if duration_s is None:
        # Live streams and some private videos report no duration. The
        # download's --max-filesize bound still applies.
        log.warning("no duration in metadata; relying on the filesize cap")
        return

    cap_s = cfg.max_duration_min * 60
    if duration_s > cap_s:
        raise PipelineError(
            f"video is {duration_s / 60:.0f} min, over the "
            f"{cfg.max_duration_min} min cap (raise MAX_DURATION_MIN to allow it)"
        )


def resolve_video(state: TranscriptState, cfg: Config) -> TranscriptState:
    """Graph node: attach metadata to the ref and apply the duration cap."""
    from . import ytdlp  # imported here so tests can patch it cheaply

    meta = ytdlp.probe_metadata(state.ref, cfg)
    ensure_within_duration(meta.get("duration"), cfg)

    state.title = meta.get("title")
    state.channel = meta.get("channel") or meta.get("uploader")
    state.duration_s = meta.get("duration")

    log.info(
        "resolved %s — %r (%s), %.1f min",
        state.ref.video_id,
        state.title,
        state.channel,
        (state.duration_s or 0) / 60,
    )
    return state
