# Design: talk-value-stats — GenAI stats extraction + static site + parquet

## Shape

```
transcript.md ──▶ extract.py ──▶ db.json ──▶ build.py ──▶ dist/index.html + <slug>.html…
  (sibling         (Claude,       (JSON DB,   (Jinja2)          │
   transcriber,     structured     committed)  export.py ──▶ dist/stats.parquet
   uncommitted)     output)                    (pyarrow)         │
                                                       GitHub Actions ──▶ Pages
```

Four small Python modules + Jinja2 templates, one JSON DB, CLI-driven, no
server. The organising principle: **exactly one generative step** (`extract`),
everything downstream is a deterministic pure function of `db.json`. That keeps
the model's blast radius tiny and the build reproducible, testable, and
key-free.

## Layer 1 — schema (`schema.py`)

Pydantic v2 is the canonical source of truth (the JSON DB, the extractor's
output contract, and the renderer all derive from it). `TranscriptStatsPage`
(one video → `speakers[]` → ordered `examples[]` → ordered `metrics[]`), plus
`Person`, `Metric`, `VideoSource`, and `ExtractedContent`.

- **Metrics are a uniform list tagged by an 8-value `category` enum** (+ `other`
  escape hatch), not fixed named fields. Real talks state numbers fixed slots
  can't hold (200 bps EBITA, 85,000 lives, 400×, weeks→minutes); a uniform list
  renders as a grid and never silently drops a striking number.
- **Grounding is mandatory**: every `Metric` carries a verbatim `quote` and an
  `HH:MM:SS` `timestamp`. This is the credibility mechanism *and* the review
  mechanism — a mis-heard name or number is caught against its own quote.
- Field names are camelCase to match the on-disk JSON and web conventions;
  `StatsDB = TypeAdapter(list[TranscriptStatsPage])` loads/dumps the array.

## Layer 2 — extraction (`extract.py`), the one GenAI call

`client.messages.parse(output_format=ExtractedContent)` — **structured
outputs**, so the model is forced to return the typed shape (validated, retried
on mismatch). The model returns only the judgement-heavy part (`headline`,
`speakers`, `examples`); the extractor builds the authoritative `VideoSource`
itself by regex-parsing the transcript header, so the video id / url / duration
are never model-guessed. Result is upserted into `db.json` by `videoId`.

- **Model from env** — `MODEL_STATS_EXTRACTOR` → `MODEL` → startup error. No
  hard-coded default (monorepo rule). Structured outputs are supported on the
  suggested `claude-opus-4-8`.
- **Prompt from config** — `prompts/extract.md`, editable without touching code.
- **Input** — transcripts from the sibling `youtube-transcriber/runs/` (override
  `$TRANSCRIBER_RUNS`); this agent consumes transcripts, never produces them.

## Layer 3 — static site (`build.py` + `templates/`)

Multipage: `index.html` (list) + one crawlable `<slug>.html` per talk. Every page
is **server-rendered** — crawlers and link-preview bots see real content; the only
JavaScript is a progressive-enhancement scroll listener that fades the title into
the sticky bar (the page is fully readable without it). Jinja2 with
`select_autoescape`; a `finalize` renders `None` as `""` (so a null field never
prints the literal "None").

**Design — editorial "timeline"** (bespoke CSS in `base.html.j2`, CSS-variable
themed, light with an evergreen accent; Space Grotesk / Newsreader / JetBrains
Mono via Google Fonts). Each detail page: a video header, then a **horizontal
talk-scrubber** (every stat moment plotted across the runtime as a clickable dot),
then a **vertical timeline** where each number hangs off its `timestamp` with the
verbatim quote. No per-category colour — one accent only (this deliberately
retires the earlier rainbow-per-category-border look). No CSS framework and no CSS
build step (an earlier Tailwind-CDN version was dropped in favour of hand-authored
CSS that matches the design and removes a runtime dependency).

**Rejected: a single-page hash-router SPA.** It was prototyped and dropped —
JS-rendered content is not crawlable, which defeats the point of a public site.
Multipage HTML is regenerated from `db.json`, so "many files" is not a
maintenance cost: you edit data, never markup.

## Layer 4 — parquet (`export.py`)

Flattens `db.json` to `dist/stats.parquet`, **one row per metric** with the
page/example/speaker context denormalized on plus a ready-made `watchUrl` deep
link — the natural analytics grain. Ships next to the site so the numbers are
queryable with **DuckDB**, including remotely over HTTPS once on Pages
(`INSTALL httpfs`) — the same pattern job-pilot uses on job-scout's trends
parquet. `build.py` writes it when pyarrow is importable and skips it otherwise
(HTML still builds).

## Model routing

One generative role only — **stats extractor** — resolved from env per the
monorepo convention. No subagents. Everything else (validation, rendering,
export) is deterministic and model-free.

## Deployment constraint

The site is static → **GitHub Pages via CI** (`talk-value-stats.yml`: test →
build → deploy). Extraction is deliberately **not** in CI: it needs a credential
and spends tokens, so it runs locally/manually and its output (`db.json`) is
committed. CI therefore needs no secret and never sees a transcript.

## Security baseline

- **Untrusted input → LLM (prompt injection).** The transcript is third-party
  text fed to a model and could contain adversarial instructions. Mitigations:
  (1) **structured outputs** constrain the model to the typed `ExtractedContent`
  shape — it cannot emit actions, only data; (2) `extract.py` takes **no action**
  beyond writing `db.json` — there is no tool use, no shell, no network fan-out
  a poisoned transcript could steer; (3) the **`VideoSource` (ids, urls) is
  parsed by regex from the transcript header, not taken from model output**, so
  a poisoned transcript cannot redirect a link or id. Worst case is bad stat
  content, caught by the mandatory grounding quotes + human review.
- **Secrets.** The Anthropic credential is used only by `extract.py`, never in
  CI, never committed. Model id comes from env, not code.
- **Copyright / privacy.** Full transcripts are **never committed** (the sibling
  transcriber's `runs/` is gitignored). `db.json` holds only short, attributed,
  single-sentence quotes from named **public promotional talks** — ordinary
  fair-use commentary, not a transcript. Committing `db.json` is the owner's
  explicit decision (2026-07-24).
- **Output safety (XSS).** Templates use Jinja `select_autoescape`, so any
  quote/title/name from `db.json` is HTML-escaped; there is no user-controlled
  JS on the page. External resources are limited to the Tailwind CDN and YouTube
  thumbnail images over HTTPS.
- **No network or keys at build or serve time** — `build.py`/`export.py` are
  pure functions of `db.json`; the published site is static files.

## Verification

Tests (no network, no model, no key; committed transcript fixture): schema
validates the committed DB, extractor assembly + upsert-dedupe, helper
functions, multipage build, and parquet export + column contract. Rendered list
+ detail checked at mobile width; `stats.parquet` queried live with DuckDB.
**Remaining:** one live `extract.py` run against a real transcript (owner's key +
tokens — the non-LLM assembly path is tested, the model call is not), and the
one-time Pages enablement.

## Non-goals (v1)

- No compiled Tailwind (CDN is acceptable; documented upgrade path).
- No server, API, or auth — static output only.
- No incremental build / pagination — one HTML file per talk is fine at this
  scale; revisit only at hundreds of talks.
- No automated fact-checking of speaker claims — the numbers are the speakers'
  own, shown with evidence; grounding quotes + human review are the safeguard,
  and the footer says so.
