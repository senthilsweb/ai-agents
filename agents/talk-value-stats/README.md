# talk-value-stats

**Turn the ROI numbers spoken in a talk into a published, queryable record — each
one attributed to who said it, grounded to the exact quote, and linked to the
second it was said.**

Part of [`senthilsweb/ai-agents`](https://github.com/senthilsweb/ai-agents) ·
agent: [`agents/talk-value-stats`](https://github.com/senthilsweb/ai-agents/tree/main/agents/talk-value-stats)

---

## The problem

Conference talks, keynotes, and podcasts are full of hard business numbers:

> "It saved that company about **$60 million**."
> "We resolve **91% of tickets**, completely autonomously."
> "**£2 billion** of additional revenue, four quarters ahead."
> "My output… it's about **400×**."

Those are exactly the numbers a buyer, an analyst, or a marketer wants — the
proof that AI is producing real business outcomes, not slideware. But they are
**trapped**: spoken once, buried inside an hour of audio, impossible to search,
awkward to quote accurately, and impossible to compare across talks. A month
later, all anyone remembers is "someone said AI saved them a lot of money."

## What this does

`talk-value-stats` reads a talk's **transcript** and produces a structured,
publishable record of the numbers in it. For every quantified claim it captures:

- the **number** and what it measures (cost saved, revenue added, productivity
  gain, FTE saved, cycle-time cut, …),
- the **speaker** and the **company** they represent,
- the **verbatim quote** that stated it, and the **timestamp** — a deep link to
  that exact second on YouTube,
- how firmly it was claimed (already achieved, projected, or a rough estimate).

It then publishes two things:

| Output | For |
|---|---|
| A fast, mobile-friendly **web page per talk** (an editorial "timeline" of the numbers) | reading, sharing, sending a link straight to the moment |
| A single **`stats.parquet`** file | querying the whole corpus with SQL / DuckDB — compare vendors, roll up by category, rank by dollar impact |

**Every number is grounded to its quote and timestamp.** Nothing is paraphrased
or invented — the extraction is constrained to a typed schema, and the evidence
travels with the number so a reader (or you) can check it against the source in
one click.

### Who it's for

- **Market & competitive intelligence** — track what vendors claim, with receipts.
- **Content & sales enablement** — pull attributed, sourced proof points instead of vague "studies show."
- **Analysts & researchers** — build a queryable dataset of AI-ROI claims across the industry.
- **Anyone** who watches a lot of talks and never wants to lose "that number" again.

## How it works

```
transcript.md ──▶ extract (GenAI, structured output) ──▶ db.json ──▶ build ──▶ dist/
   (from the        one figure, one quote, one timestamp    (the JSON   • index.html
    youtube-         at a time, attributed to a speaker       "database"  • a page per talk
    transcriber      → upsert by video id                     of stats)   • stats.parquet
    agent)                                                                      │
                                                                    GitHub Actions ──▶ Pages
```

One generative step only — the extraction. Everything after it (the site, the
parquet) is a deterministic, offline function of `db.json`. The **transcripts
themselves are never published** (they are third-party copyrighted speech); only
the extracted numbers and their short evidence quotes are.

> Transcripts come from a sibling tool, the **youtube-transcriber** agent, which
> does the audio-to-text locally. For the full pipeline across both tools — from
> a YouTube link to a deployed page — see **[DEVELOPER.md](DEVELOPER.md)**.

---

## Quick start

```bash
cd agents/talk-value-stats
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
```

### Add a talk's numbers (the one step that uses AI)

```bash
export MODEL_STATS_EXTRACTOR=claude-opus-4-8        # model comes from env, no default
# credentials: export ANTHROPIC_API_KEY=…  (or run `ant auth login` once)

.venv/bin/python extract.py ../youtube-transcriber/runs/<ts>-<id>/transcript.md
.venv/bin/python extract.py <video-id>              # or by id — finds the latest transcript
```

It reads the transcript, extracts the numbers into `db.json` (re-running a video
**replaces** its entry), and stops. You can also hand-edit `db.json` directly.

### Build & preview the site

```bash
.venv/bin/python build.py                           # → dist/ (HTML + stats.parquet)
cd dist && python3 -m http.server 8080              # → http://localhost:8080/
```

`build.py` needs no key and no network — it is a pure function of `db.json`.

### Query the numbers with SQL

Every metric is a row in `stats.parquet`, with the talk/speaker context and a
ready-made `watchUrl` deep link:

```bash
duckdb -c "SELECT category, count(*) FROM 'dist/stats.parquet' GROUP BY 1 ORDER BY 2 DESC;"
```

Because it ships next to the site, once it's on GitHub Pages you can query it
remotely without downloading it:

```sql
INSTALL httpfs; LOAD httpfs;
SELECT primaryCompany, display, watchUrl
FROM 'https://senthilsweb.github.io/ai-agents/stats.parquet'
WHERE category = 'cost_savings' AND confidence = 'stated'
ORDER BY value DESC NULLS LAST;
```

### Deploy

`.github/workflows/talk-value-stats.yml` runs the tests, builds `dist/`, and
publishes to **GitHub Pages** on every push to `main` that touches this agent.
CI never runs extraction, so it needs no secret and never sees a transcript.
(Enable once: repo **Settings → Pages → Source = GitHub Actions**.)

### Test

```bash
.venv/bin/python -m pytest -q        # no network, no model, no key
```

---

## What's in here

| Path | What it is |
|---|---|
| `schema.py` | The source of truth — a typed (pydantic) schema for a talk, its speakers, and its metrics. |
| `db.json` | The JSON "database" — one committed array of talks. |
| `extract.py` | The extractor CLI. The only place a GenAI model is called. |
| `prompts/extract.md` | The extraction prompt — editable, no code change needed. |
| `build.py` | Renders `db.json` → the static site + `stats.parquet`. |
| `export.py` | Flattens `db.json` → `stats.parquet` (one row per metric). |
| `templates/` | The site — `base` (design system), `index` (list), `detail` (timeline). |
| `dist/` | Generated output (gitignored; CI rebuilds it). |

## Design

An editorial **timeline** (light, warm paper, evergreen accent). Each detail page
opens with the video and speaker, then a **horizontal talk-scrubber** plots every
stat moment across the talk's runtime as a clickable dot — so you can see at a
glance where in the talk the numbers land and jump straight there. Below it, a
**vertical timeline** hangs each number off its timestamp with the verbatim quote.
One accent colour, no per-category rainbow. It is hand-authored CSS (CSS
variables — retheme by editing `:root`) with Google Fonts; no CSS framework, no
build step, and the only JavaScript is a small progressive enhancement — so every
page is fully server-rendered and readable without JS (and indexable by search
engines and link-preview bots).

## Notes

- **Where the numbers come from is only as good as the transcript.** The
  transcriber is verbatim speech-to-text, so it can mishear a name or an acronym
  ("Kathryn" → "Catherine", "bps" → "BIPs"). The grounding quote and timestamp on
  every metric are exactly what let you catch and correct these against the source.
- **The claims are the speakers' own.** This tool records and attributes them; it
  does not verify them. Every page and the footer say so.
- Full design, security notes, and the process record live in
  `openspec/changes/add-talk-value-stats/` at the repo root.

For the end-to-end workflow across the transcriber and this tool, read
**[DEVELOPER.md](DEVELOPER.md)**.
