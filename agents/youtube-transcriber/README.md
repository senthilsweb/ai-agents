# youtube-transcriber

Give it a YouTube video. Get back the full spoken transcript.

Not the captions, not the description, not the title — the actual audio,
transcribed end to end. It runs entirely on your machine, so a run costs
**zero LLM tokens and zero dollars**.

```bash
python run.py https://www.youtube.com/watch?v=EQuCyrwyfXU
```

```
  A Talk About Systems
  842 segments, 9,431 words
  → runs/20260723T091455Z-EQuCyrwyfXU/
```

## What you get

Every run writes one folder under `runs/`:

| File | What it is |
|---|---|
| `transcript.md` | The readable transcript, split into paragraphs with `[HH:MM:SS]` markers |
| `transcript.json` | Full text plus every segment with start and end times |
| `transcript.srt` | Subtitles, ready for a video player |
| `metrics.json` | How long each stage took, and the realtime factor |

## Setup

Two things have to be on your machine before the first run.

```bash
# 1. ffmpeg — used to normalize the audio
brew install ffmpeg

# 2. Python dependencies
python3 -m venv .venv
.venv/bin/pip install -e .
```

The first transcription also downloads the Whisper model weights, about
1 GB. That happens once and is cached in `~/.cache/huggingface`. Later runs
start immediately.

You do not need an API key. There is nothing to sign up for.

## Using it

```bash
# One video — id or URL, any shape
.venv/bin/python run.py EQuCyrwyfXU
.venv/bin/python run.py "https://www.youtube.com/watch?v=EQuCyrwyfXU&t=19s"
.venv/bin/python run.py https://youtu.be/gYAqupu6iNI

# Several at once. They run one after another, and if one fails the
# rest still finish.
.venv/bin/python run.py EQuCyrwyfXU gYAqupu6iNI

# Try a faster model, or force a language
.venv/bin/python run.py EQuCyrwyfXU --model small.en
.venv/bin/python run.py EQuCyrwyfXU --language en
```

## How long does it take

The download is quick. Transcription is the slow part, because
`faster-whisper` runs on the **CPU** — the library has no Metal backend, so
there is no GPU to use on a Mac.

**Measured on this machine** (2026-07-23, Apple Silicon, default
`distil-large-v3` at `int8`): a 14.8-minute video transcribed in
**3.0 minutes**. That is a realtime factor of about **4.8** — roughly a
fifth of the video's length in wall-clock time.

| Video length | Expect roughly |
|---|---|
| 10 minutes | 2 minutes |
| 30 minutes | 6 minutes |
| 60 minutes | 12 minutes |

**The very first run is much slower**, because it downloads the model. Budget
an extra 4–5 minutes once. After that the model loads from disk in about
2 seconds and these numbers hold.

Check `metrics.json` after any run for the real number on your machine. It
records `model_load_s` and `asr_s` separately, so a first run's download
never gets mistaken for slow transcription.

If that is too slow, `--model small.en` is several times faster and
noticeably less accurate. The default was chosen the other way round: get
the words right, and wait.

## The audio cache

The normalized audio is kept in `.cache/audio/<video_id>.opus`. Run the same
video again — with a different model, say — and it skips the download
entirely. You will see `(cached audio)` in the output.

To force a fresh download, delete that file.

## If YouTube blocks the download

YouTube sometimes refuses downloads it thinks come from a bot. If that
happens, export your browser cookies to a file and point the agent at it:

```bash
echo 'YT_COOKIES_FILE=/path/to/cookies.txt' >> .env
```

Never commit that file. `.gitignore` already covers `*.cookies.txt`.

## Configuration

Copy `.env.example` to `.env` and edit what you need. Everything is
optional — the defaults work. The useful knobs are `ASR_MODEL`,
`ASR_LANGUAGE`, and `MAX_DURATION_MIN` (videos longer than 180 minutes are
rejected before anything downloads).

## A note on what you transcribe

This is a personal reading aid: it helps you search and quote talks you are
already watching. Transcripts are somebody else's words, so `runs/` and
`.cache/` are gitignored and nothing a run produces is ever committed to
this public repository. Don't republish what comes out of it.

## How it works

A LangGraph `StateGraph` with five nodes and one branch:

```
resolve_video → audio_cached?
                   ├─ no  → fetch_audio ────┐
                   └─ yes → use_cached_audio ┴→ transcribe → write_outputs
```

`resolve_video` is the only place untrusted input is handled. It pulls the
11-character video id out of whatever you pasted, throws away every other
query parameter, and rejects anything that is not a YouTube link. Every
subprocess argument and every file path downstream is built from that id
alone.

There is no LLM anywhere in the pipeline — no prompt, no completion, no
tokens. That is why the tests are ordinary pytest rather than model-judged
evals.

```bash
.venv/bin/python -m pytest      # 73 tests, no network
```

The full design lives in
`openspec/changes/add-youtube-transcriber/` at the repo root.
