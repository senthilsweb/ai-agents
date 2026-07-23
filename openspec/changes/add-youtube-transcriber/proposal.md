# Proposal: youtube-transcriber — full audio transcript from a YouTube video

> Status: **PROPOSED** — drafted 2026-07-22. Owner: @senthilsweb.
> Use case: **Turn a talk into text I can actually work with.**

## Why

The owner watches conference talks, podcasts, and interviews on YouTube and
wants the *spoken content* as text — to quote in an article, to feed a deck,
to search later. YouTube's own auto-captions are the obvious shortcut and
they are not good enough: they are chunked for on-screen display, drop
punctuation and speaker turns, are missing entirely on many videos, and are
sometimes disabled by the uploader. The title and description are metadata,
not content.

So the requirement is the hard one: **take the actual audio track and
transcribe it end to end.**

The second requirement is cost. The owner's other agents route through paid
models, and a 60-minute talk is a lot of content to push through one. The
insight that shapes this whole design is that **transcription is not a
text-generation task** — it is ASR. There is no reasoning step, so there is
no prompt, no completion, and **no LLM token spend at all**. Done locally,
a run costs electricity and nothing else.

## What changes

One new agent, `agents/youtube-transcriber/`, a **LangGraph** Python pipeline
(ADR 0003 — `StateGraph`, no LangChain chains) with four capabilities:

1. **audio-acquisition** — validate the input as a YouTube video ID or URL,
   download the audio stream only with `yt-dlp` (never the video), and
   normalize it with `ffmpeg` to 16 kHz mono. Downloaded audio is cached by
   video ID so re-transcribing with a different model costs one local file
   read, not another download.
2. **transcription** — `faster-whisper` running **entirely on the local
   machine**. No API key, no network call, no audio leaving the box, no
   tokens. Returns timestamped segments, not a wall of text.
3. **transcript-output** — one `runs/<timestamp>-<video_id>/` folder per
   video holding `transcript.json` (segments + timings + metadata),
   `transcript.md` (the readable full transcript), `transcript.srt`
   (subtitles), and `metrics.json` (wall-clock per stage, realtime factor).
4. **run-orchestration** — a CLI entrypoint that takes one or more video
   IDs/URLs and runs the graph once per video, sequentially.

The agent contains **no LLM reasoning of its own** — same shape as job-pilot
— so its evals are plain `pytest`, not LLM-judged rubrics.

## Impact

- New: `agents/youtube-transcriber/` (LangGraph app, tests, README), a
  youtube-transcriber entry in root `AGENTS.md`. No Dockerfile, no CI
  workflow — gate decision 2026-07-23, this is a local CLI tool only.
- Unchanged: every other agent. This one stands alone — it consumes nothing
  from the monorepo and nothing consumes it (v1).
- New external prerequisites, neither currently installed on the dev
  machine: **`ffmpeg`** (`brew install ffmpeg`; `apt` in the image) and
  **faster-whisper model weights** (~1 GB, downloaded once on first run,
  cached under `~/.cache/huggingface`).
- Privacy/legal: transcripts are third-party copyrighted speech. `runs/` is
  **gitignored** for this agent (same exception job-matcher takes), so no
  transcript of someone else's talk is ever committed to the public repo.
  The tool is a personal-use reading aid; it does not republish anything.

## Non-goals (v1)

Listed in full in design.md. The short version: no summarization, no
speaker diarization, no translation, no playlist/channel crawling, no
server or API endpoint, no GUI.
