# Developer guide — from a YouTube link to a deployed page

This walks the **full pipeline end to end**, across the two agents it uses:

1. **`youtube-transcriber`** — turns a YouTube video into a full spoken
   transcript, entirely on your machine. No LLM, no API key, no tokens.
2. **`talk-value-stats`** (this agent) — reads that transcript, extracts the
   business-value numbers with a GenAI model, and publishes a site + a
   `stats.parquet`.

They are separate agents on purpose: the transcriber stays 100% local and
key-free, and this agent is the only one that calls a model. This agent
**consumes** the transcriber's output; it never produces transcripts.

```
YouTube video ─▶ youtube-transcriber ─▶ runs/<ts>-<id>/transcript.md ─▶ talk-value-stats ─▶ db.json ─▶ dist/ ─▶ Pages
  (a link)         (local ASR, no LLM)     (never committed)              (extract, GenAI)   (committed)  (site + parquet)
```

Both agents live in the same repo:
[`senthilsweb/ai-agents`](https://github.com/senthilsweb/ai-agents), as
`agents/youtube-transcriber/` and `agents/talk-value-stats/`.

---

## Prerequisites

| Need | For | Install |
|---|---|---|
| **Python 3.12+** | both agents | your platform's Python |
| **ffmpeg** | the transcriber (audio normalization) | `brew install ffmpeg` (macOS) / `apt install ffmpeg` (Debian/Ubuntu) |
| **~1 GB disk + a first-run download** | the transcriber's Whisper weights | happens automatically on the first transcription |
| **An Anthropic credential** | the extractor (one model call) | `export ANTHROPIC_API_KEY=…`, or `ant auth login` once |
| **duckdb** (optional) | querying the parquet from a shell | `brew install duckdb`, or use the Python `duckdb` in the `[dev]` extra |

Clone the repo first:

```bash
git clone https://github.com/senthilsweb/ai-agents.git
cd ai-agents
```

---

## Part A — produce a transcript (`youtube-transcriber`)

This is a separate agent with its own setup. Full detail in
`agents/youtube-transcriber/README.md`; the short version:

```bash
cd agents/youtube-transcriber
python3 -m venv .venv
.venv/bin/pip install -e .

# transcribe a video — id or URL, any shape
.venv/bin/python run.py https://www.youtube.com/watch?v=gYAqupu6iNI
```

- The **first run downloads the ASR weights (~1 GB)** and is slow; later runs
  start immediately. Transcription runs on CPU, roughly a fifth of the video's
  length in wall-clock time (a 15-minute talk ≈ 3 minutes).
- Output lands in a timestamped folder:
  `runs/<YYYYMMDDThhmmssZ>-<video-id>/` containing `transcript.md` (the one this
  agent reads), plus `transcript.json`, `transcript.srt`, and `metrics.json`.
- **If YouTube blocks the download** (it blocks datacenter/VPN IPs), export your
  browser cookies to a file and point the agent at it:
  `echo 'YT_COOKIES_FILE=/path/to/cookies.txt' >> .env`. Never commit that file.
- Useful knobs (in `.env`): `ASR_MODEL`, `ASR_LANGUAGE`, `MAX_DURATION_MIN`.

`runs/` is **gitignored** — transcripts are verbatim third-party speech and are
never committed. They only need to exist locally for the next step.

---

## Part B — extract, build, run (`talk-value-stats`)

```bash
cd ../talk-value-stats
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
```

### 1. Extract the numbers (the one GenAI step)

```bash
export MODEL_STATS_EXTRACTOR=claude-opus-4-8        # model from env; there is no default
# credentials already set via ANTHROPIC_API_KEY or `ant auth login`

# by transcript path:
.venv/bin/python extract.py ../youtube-transcriber/runs/20260723T120805Z-gYAqupu6iNI/transcript.md

# or just by video id — it finds the latest transcript for that id:
.venv/bin/python extract.py gYAqupu6iNI
```

What happens:

- The video **id, title, channel, and duration** are parsed from the transcript
  header (authoritative — never guessed by the model).
- The model is asked, with a schema it must conform to, for the judgement part:
  the speakers, the examples, and each grounded metric (number + quote +
  timestamp).
- The result is **upserted into `db.json` by video id** — re-running a video
  replaces its entry rather than duplicating it.

By default it looks for transcripts under the sibling
`agents/youtube-transcriber/runs/`. Point it elsewhere with `TRANSCRIBER_RUNS`:

```bash
export TRANSCRIBER_RUNS=/some/other/runs
```

> Prefer to skip the model entirely? `db.json` is plain JSON and hand-editable.
> `build.py` and the tests validate whatever it contains.

### 2. Build and preview the site

```bash
.venv/bin/python build.py                           # → dist/ (index + a page per talk + stats.parquet)
cd dist && python3 -m http.server 8080              # → http://localhost:8080/
```

Open the list, click a talk, hover the scrubber dots, and click a timestamp to
jump to that second on YouTube. `build.py` uses no key and no network.

### 3. Query the data

```bash
# local:
duckdb -c "SELECT primaryCompany, display, watchUrl
           FROM 'dist/stats.parquet'
           WHERE category='cost_savings' ORDER BY value DESC NULLS LAST;"

# from the venv, if you don't have the duckdb CLI:
.venv/bin/python -c "import duckdb; duckdb.sql(\"SELECT category, count(*) FROM 'dist/stats.parquet' GROUP BY 1 ORDER BY 2 DESC\").show()"
```

---

## Configuration reference

| Variable | Agent | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` (or `ant auth login`) | talk-value-stats | credential for the one model call in `extract.py` |
| `MODEL_STATS_EXTRACTOR` → `MODEL` | talk-value-stats | which model to extract with; no hard-coded default (startup errors if unset) |
| `TRANSCRIBER_RUNS` | talk-value-stats | where to look up transcripts (default: `../youtube-transcriber/runs`) |
| `ASR_MODEL`, `ASR_LANGUAGE`, `MAX_DURATION_MIN` | youtube-transcriber | ASR model/language and a duration cap |
| `YT_COOKIES_FILE` | youtube-transcriber | browser cookies to get past YouTube's bot block |

---

## Deploy to GitHub Pages

CI does the deploy — you don't build in the cloud by hand:

1. In the repo, enable Pages once: **Settings → Pages → Source = GitHub Actions**.
2. Commit your updated `db.json` (the committed record) and push to `main`.
3. `.github/workflows/talk-value-stats.yml` runs the tests, builds `dist/`
   (HTML + `stats.parquet`), and publishes it. It needs **no secret** and never
   sees a transcript — it only renders the committed `db.json`.

The site is then live at `https://senthilsweb.github.io/ai-agents/`, and the
parquet at `https://senthilsweb.github.io/ai-agents/stats.parquet`.

---

## Testing

```bash
# this agent — no network, no model, no key:
cd agents/talk-value-stats && .venv/bin/python -m pytest -q

# the transcriber — no network, no model, no secrets:
cd agents/youtube-transcriber && .venv/bin/python -m pytest -q
```

This agent's suite covers everything except the live model call: schema
validation of `db.json`, the extractor's non-LLM assembly path (header parse →
build page → upsert → re-validate, using a committed fixture transcript), the
build, and the parquet contract. The live `extract.py` model call is the one
thing you verify by hand with a real key.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `extract.py` exits: "No model configured" | Set `MODEL_STATS_EXTRACTOR` (or `MODEL`). |
| `extract.py`: auth / 401 | Set `ANTHROPIC_API_KEY`, or run `ant auth login`. |
| `extract.py`: "No transcript found for video id …" | Run the transcriber for that video first, or pass the `transcript.md` path directly, or set `TRANSCRIBER_RUNS`. |
| Transcriber: download refused / "Sign in to confirm you're not a bot" | YouTube is blocking the IP — set `YT_COOKIES_FILE` (see Part A). |
| Transcriber: first run is very slow | It's the one-time ~1 GB weights download; later runs are fast. |
| Transcriber: `ffmpeg not found` | `brew install ffmpeg` / `apt install ffmpeg`. |
| `build.py`: "pyarrow not installed — skipped stats.parquet" | `pip install -e .` (or `.[dev]`); the HTML still builds without it. |
| A speaker name or number looks wrong | The ASR misheard it — open the metric's timestamp link, check the source, and fix `db.json`. |
