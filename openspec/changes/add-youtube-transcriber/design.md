# Design — `youtube-transcriber`

## Context

This is a four-step deterministic pipeline with no model reasoning in it:
resolve a video ID, pull its audio, run ASR, write files. Everything below
follows from three constraints the owner set at Inception — **fast**,
**no token spend**, and **the real audio, not the captions** — plus one
repo constraint: Python orchestration agents use LangGraph (ADR 0003).

The "no token spend" constraint is satisfied absolutely, not approximately.
There is no LLM client library in the dependency list. A run's marginal
cost is zero.

## Architecture

One LangGraph `StateGraph`, linear with a single conditional edge:

```
resolve_video → audio_cached?
                   ├─ no  → fetch_audio → normalize_audio ─┐
                   └─ yes ─────────────────────────────────┴→ transcribe → write_outputs
```

The branch exists for a real reason (ADR 0003 §3 requires branches be
justified): re-running the same video with a different model or a fixed
output format is the common iteration loop, and re-downloading a 60-minute
talk each time is both slow and an unnecessary hit on YouTube.

### State (pydantic models, `pipeline/state.py`)

```python
class VideoRef(BaseModel):
    video_id: str          # 11-char YouTube ID, validated by regex
    source_url: str        # canonical https://www.youtube.com/watch?v=<id>

class Segment(BaseModel):
    index: int
    start_s: float
    end_s: float
    text: str

class TranscriptState(BaseModel):
    ref: VideoRef
    title: str | None = None
    channel: str | None = None
    duration_s: float | None = None
    audio_path: str | None = None      # cached, normalized 16kHz mono
    cache_hit: bool = False
    language: str | None = None        # detected or forced
    segments: list[Segment] = []
    full_text: str = ""
    run_dir: str | None = None
    metrics: dict = {}                 # per-stage wall clock
    failures: list[str] = []
```

Pydantic models rather than a bare `TypedDict` — the owner asked for
pydantic, and `video_id` validation belongs on the model, not scattered
through nodes.

### Nodes

1. **resolve_video** — accepts a bare 11-character ID, a `watch?v=` URL, a
   `youtu.be/` short link, or a `/live/` or `/shorts/` URL. Extracts the ID
   with a strict regex and **discards every other query parameter** — the
   owner's first seed link carries `&t=19s&pp=…`, and tracking params must
   never reach a subprocess or a filesystem path. Then one `yt-dlp -J`
   metadata call fills `title`, `channel`, `duration_s`. A video longer than
   `MAX_DURATION_MIN` (default 180) is rejected before anything is
   downloaded.
2. **fetch_audio** — `yt-dlp -f bestaudio --extract-audio` into the cache
   dir. Retried up to 3 times with exponential backoff (tenacity). Retry is
   correct here and was wrong in job-pilot's matcher because this call is
   **free and idempotent** — the thing job-pilot's one-attempt-no-retry rule
   was protecting against (paid duplicate LLM calls) does not exist.
3. **normalize_audio** — `ffmpeg -ac 1 -ar 16000 -c:a libopus -b:a 16k`.
   Whisper resamples to 16 kHz mono internally regardless, so this discards
   nothing and shrinks a 60-minute talk to roughly 7 MB. Cheap insurance
   against oversized intermediates and the main reason chunking is not
   needed at these durations.
4. **transcribe** — `faster-whisper` (CTranslate2), local, `WhisperModel`
   loaded once per process. Defaults: model `distil-large-v3`,
   `compute_type=int8`, `vad_filter=True`. VAD matters twice over: it skips
   silence (faster) and it suppresses Whisper's well-known habit of
   hallucinating text into long silent stretches. Language is auto-detected
   unless `ASR_LANGUAGE` forces it. **No retry** — the step is local and
   deterministic; a failure is a real failure.
5. **write_outputs** — creates `runs/<UTC-timestamp>-<video_id>/` and writes
   the four artifacts. Directory name is built from the *validated* ID, so
   it cannot escape `runs/`.

## Tech stack — LangGraph, not LangChain (ADR 0003)

- **LangGraph `StateGraph` is mandatory; LangChain chains/agents are
  forbidden.** v1 would work as a shell script; the graph buys the same
  things it bought job-pilot — one mental model across the repo's Python
  agents, per-node tracing for free, and a place to hang v2 branches
  (chunked long-form audio, a diarization node) without a rewrite.
- Python 3.12, `langgraph`, `pydantic`, `yt-dlp`, `faster-whisper`,
  `tenacity`, `pytest`. No `langchain` meta-package; `langchain-core` only
  as a transitive dependency, never imported.
- **No LLM client library at all** — that absence is the design.

## ASR engine — local `faster-whisper` (gate decision)

Owner chose local over the hosted Groq path. Consequences, stated honestly:

| | Chosen: local faster-whisper | Rejected: Groq turbo |
|---|---|---|
| Cost per run | **$0.00** | ~$0.04 per audio-hour |
| 60-min video | **~12 min** (measured, see below) | ~15–30 s |
| Audio leaves machine | **never** | yes |
| Setup | ffmpeg + ~1 GB weights | API key |

**Correction 1 (2026-07-23, Bolt 3 measurement) — and a real defect it
exposed.** The drafted estimate was 5–10 minutes for a 60-minute video.
Measured on Apple Silicon CPU, `distil-large-v3` at `int8`:

| Run | Audio | Node time | `asr_s` | RTF |
|---|---|---|---|---|
| `EQuCyrwyfXU`, first ever run | 888 s | 457.5 s | — | 1.94 |
| `gYAqupu6iNI`, same process | 1092 s | 234.2 s | — | 4.68 |
| `EQuCyrwyfXU`, warm re-run | 888 s | 182.6 s | 180.7 s | **4.91** |

The 2.4x spread between the first two runs is not variance — it is a
measurement defect. `load_model()` sat **inside** the timed transcribe
node, so the first run of a machine's life charged a one-time ~1 GB weight
download to transcription. The warm re-run proves it: `model_load_s` fell
from roughly 267 s to **1.91 s** while `asr_s` held at 180.7 s, and the
output was identical (153 segments, 2521 words), confirming the cache path
is correct and not merely fast.

Fixed rather than documented around: `transcribe.py` now times model load
and ASR separately, and `outputs.py` computes `realtime_factor` from
`asr_s` alone, falling back to node time only when absent. Two tests pin
it (`test_realtime_factor_excludes_model_load_time`,
`test_realtime_factor_falls_back_to_node_time`).

**Honest figure: ~4.8x realtime.** A 30-minute video takes ~6 minutes, a
60-minute video ~12 — close to the original estimate, which the corrupted
first measurement had briefly made look 3x pessimistic. Download plus
normalize is ~10 s and negligible. Per the gate decision none of this
changes the default model; accuracy was explicitly preferred over speed.

**Apple Silicon caveat, worth stating plainly:** CTranslate2 has no Metal
backend, so faster-whisper runs on **CPU** on macOS — there is no GPU
acceleration to fall back on. The 5–10 minute figure for a 60-minute video
is a CPU int8 estimate and is the single number most likely to be wrong;
Bolt 3 measures it against the two seed videos and this table gets amended
with the real number. If it lands badly, the escape hatches are, in order:
`distil-large-v3` → `large-v3-turbo` → `small.en`, then `ASR_ENGINE=groq`
as a later change.

*Amended at the gate (2026-07-23): the owner accepts the wait. A slow
measurement in Bolt 3 is recorded, not acted on — `distil-large-v3` stays
the default because accuracy is preferred over speed. The escape hatches
below remain available to anyone who wants the trade, but they are not the
plan.*

Everything about the engine is env-driven (`ASR_MODEL`, `ASR_COMPUTE_TYPE`,
`ASR_LANGUAGE`, `ASR_BEAM_SIZE`) so trying a different model is a config
edit, not a code change.

## Data design

- **The cache is the only persistent state.** `.cache/audio/<video_id>.opus`,
  gitignored. Presence of that file is the conditional edge's whole
  condition — no ledger, no database, same stateless-by-construction
  instinct as job-pilot.
- **`runs/` is gitignored for this agent.** This is the second deliberate
  exception to the monorepo's "runs/ is committed" convention, after
  job-matcher's (PII). The reason here is different: transcripts are
  verbatim third-party copyrighted speech, and this is a public repo.
- Multiple videos in one invocation each get their own run folder. There is
  no combined output file.

## Observability

Same dual-export contract as job-pilot (`agents/job-pilot/pipeline/
telemetry.py`), and the same rule that it degrades to a warning: a missing
or unreachable backend must never stop a transcript being written.

- **LangSmith** — native to LangGraph, env-only: `LANGSMITH_TRACING=true` +
  `LANGSMITH_API_KEY`, project `youtube-transcriber`. No wiring code; the
  runtime traces every node itself. Asserted by a test that the module
  imports no `langsmith` package.
- **OTel dual export** — spans fan out to OpenObserve
  (`OTEL_EXPORTER_OTLP_ENDPOINT`) and Arize / Phoenix
  (`PHOENIX_COLLECTOR_ENDPOINT`) simultaneously. Both variables accept the
  eve-agent form (`…/api/default`) or a full OTLP traces URL;
  `_traces_url` normalizes either.
- The resource carries **`model_id`** as well as `service.name`. Arize AX's
  collector returns 500 for spans without it — a defect found the hard way
  in job-pilot on 2026-07-15 and inherited here rather than rediscovered.
- One root span per video (`video_id`, `source`), one child span per node
  (`node.resolve`, `node.fetch_audio`, `node.transcribe`, …), stage timings
  as span attributes.
- Secrets are copied from `agents/job-pilot/.env` into this agent's
  gitignored `.env` — all seven telemetry variables, with
  `LANGSMITH_PROJECT` repointed to `youtube-transcriber` so its traces do
  not land in job-pilot's project.
- `metrics.json` is the local, always-available version of the same data —
  and the authority on the realtime factor above.

## Failure handling and logging

- `resolve_video` and `transcribe` failures fail that video's run (nothing
  useful follows either).
- With several videos on one command line, a failure on one is logged,
  recorded, and the next video still runs; the exit code is non-zero if any
  video failed.
- Structured timestamped log file per invocation (job-scout/job-pilot
  pattern). Logs carry video IDs, durations, and error reasons — **never
  transcript text**.

## Evals — code-level tests only (pytest, no network)

1. **id-parsing**: bare ID, `watch?v=` with extra params (the seed link's
   `&t=19s&pp=…`), `youtu.be`, `/live/`, `/shorts/` → same ID; a non-YouTube
   URL, a path-traversal attempt, and a shell-metacharacter string → rejected.
2. **duration-cap**: metadata reporting 4 hours → rejected before download.
3. **cache-branch**: cache file present → `fetch_audio`/`normalize_audio`
   skipped, `cache_hit=True`; absent → both run.
4. **retry-policy**: mocked `yt-dlp` failing twice then succeeding → 3 calls
   total; failing always → recorded failure, no exception escapes the run.
5. **transcription-adapter**: a stub segment iterator → correct `Segment`
   list, monotonic timings, joined `full_text`.
6. **outputs**: golden segments → `transcript.json` schema, `.md` shape,
   and `.srt` formatting (`HH:MM:SS,mmm`, blank-line separated, 1-indexed);
   a hostile title does not escape the run directory.
7. **graph**: full `StateGraph` with every node mocked → node order, both
   branches of the conditional edge, failure accumulation.
8. **multi-video**: two refs, first one fails → second still processed,
   exit code non-zero.

## Deployment — none

*Gate decision (2026-07-23): no Docker in v1.* This is a local CLI tool and
nothing more — no image, no GHCR publish, no CI workflow, no server. A
GitHub-hosted runner would be both a poor place to do CPU transcription and
a likely target for YouTube's datacenter-IP blocking, so there is no
near-term case for containerising it either. Containers move to non-goals.

## Security baseline

1. **Subprocess injection** — `yt-dlp` and `ffmpeg` are invoked with
   argument **lists**, never a shell string, never `shell=True`. The only
   value derived from user input that reaches them is the video ID, and it
   has already passed `^[A-Za-z0-9_-]{11}$`.
2. **Path traversal** — run directories and cache filenames are built from
   the validated ID only. Titles and channel names are metadata written
   *into* files, never used as path components.
3. **SSRF / host allowlist** — the resolver accepts only `youtube.com`,
   `www.youtube.com`, `m.youtube.com`, `youtu.be`. Any other host is
   rejected before `yt-dlp` runs, so this cannot be turned into a
   general-purpose downloader.
4. **Size and duration caps** — `MAX_DURATION_MIN` (default 180) checked
   against metadata pre-download, plus `yt-dlp --max-filesize` as a
   belt-and-braces second bound.
5. **Copyright / republication** — `runs/` gitignored; the README states
   plainly that this is a personal reading aid and that transcripts of other
   people's talks should not be republished.
6. **Cookies** — YouTube bot-blocking may require a cookie file. Its path
   comes from `YT_COOKIES_FILE` (env only), it is never committed, and the
   `.gitignore` covers `*.cookies.txt`. If unset, the agent simply runs
   without it.
7. **Secrets** — there are none in the local path. No API key, nothing to
   leak. `LANGSMITH_API_KEY` is optional and env-only.
8. **Prompt injection** — not applicable. There is no prompt anywhere in
   this agent.

## Verification fixtures

The owner supplied two real videos for the live verification pass:

| Video ID | Source |
|---|---|
| `EQuCyrwyfXU` | `https://www.youtube.com/watch?v=EQuCyrwyfXU&t=19s&pp=…` (tracking params stripped by `resolve_video` — this link is also eval 1's fixture) |
| `gYAqupu6iNI` | `https://www.youtube.com/watch?v=gYAqupu6iNI` |

Both run end to end in Bolt 5, with measured stage timings recorded back
into this document's ASR table. Their transcripts stay local — gitignored,
never committed.

## Non-goals (v1)

- **Summarization / Q&A over the transcript** — the moment an LLM enters,
  the zero-token property is gone. If wanted, it belongs in a separate
  agent that *consumes* `transcript.json`.
- **Speaker diarization** ("who said what") — needs `pyannote`, a HuggingFace
  token, and a lot of tuning. Slots in as a node after `transcribe` in v2.
- **Translation** — Whisper can do it; out of scope.
- **Playlist / channel crawling** — v1 takes explicit video IDs only.
- **Docker / any container** — gate decision 2026-07-23, see Deployment.
- **Non-YouTube sources**, **an API endpoint or GUI**, **CI scheduling**,
  **caption fallback** (explicitly rejected in the proposal — captions are
  the thing this agent exists to avoid).

## Intended use

Internal productivity automation for the owner, on the owner's machine.
Transcripts are a personal reading and search aid over talks the owner is
already watching. Third-party work is never pushed to the public repo and
never republished — that is the owner's stated framing at the gate and the
reason `runs/` is gitignored.
