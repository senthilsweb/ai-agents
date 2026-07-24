# Proposal: `talk-value-stats` — a GenAI stats extractor + site + parquet

> Status: **PROPOSED** — drafted 2026-07-24. Owner: @senthilsweb.
> Builds on: `add-youtube-transcriber` (consumes its transcripts).
> Use case: **Publish the hard business numbers a talk claims — extracted by a
> model, one blog page per video + a DuckDB parquet, deployed to GitHub Pages.**

> **A separate agent** (`agents/talk-value-stats/`), not a sub-layer of the
> transcriber. It began as `youtube-transcriber/site/` but was promoted so the
> transcriber keeps its clean "no LLM anywhere — no prompt, no completion, no
> tokens, no API key" identity: this agent is the one that calls a model. It
> **consumes** the transcriber's `runs/*/transcript.md` as input.

## Why

The transcriber turns a talk into a full spoken transcript. Buried in those
transcripts are the numbers that matter to a reader — "$60M saved", "91% of
tickets auto-resolved", "£2B revenue four quarters early", "400× output". Today
those numbers live inside a wall of paragraph text in `runs/<id>/transcript.md`,
un-skimmable and uncommittable (copyright).

The owner wants a repeatable pipeline: point a tool at a transcript, have a
**GenAI model extract the quantified value claims** into a typed shape, keep
them in a **single JSON DB**, and generate a **static, mobile-first blog** — a
list view (thumbnail · title · author · headline stat) linking to a detail page
per talk — that deploys to **GitHub Pages** via CI. Only the extracted stats and
the generated HTML are committed; the full transcript never is.

## What changes

Everything lands in the new `agents/talk-value-stats/` agent. **Python**,
CLI-driven, no server.

1. **`schema.py`** — the pydantic v2 source of truth, `schemaVersion: 2`.
   `TranscriptStatsPage` = one video (`source`, `speakers[]`, `slug`, ordered
   `examples[]`). `Example` = one case study (`useCase`, `org?`, `speakerName?`,
   `summary`, ordered `metrics[]`). `Metric` = one grounded number: an 8-value
   `category` enum (`productivity_gain`, `cost_savings`, `additional_revenue`,
   `fte_savings`, `cycle_time`, `quality`, `scale`, `other`) plus `display`,
   `value?`, `unit`, `direction`, `confidence`, and — always — the verbatim
   `quote` and `timestamp`. **New in v2:** `Person` (name/role/company + optional
   headshot/profile), page-level `speakers[]`, per-example `speakerName`, and a
   `slug`. A separate `ExtractedContent` model is what the LLM returns (the
   judgement-heavy part only); the extractor assembles the authoritative
   `VideoSource` itself.

2. **`extract.py`** — the CLI. Reads a `transcript.md`, parses the video
   id/title/channel/duration from its header (authoritative, not model-guessed),
   loads the prompt from `prompts/extract.md`, and calls Claude via
   `client.messages.parse(output_format=ExtractedContent)` — **structured
   outputs**, so the model is forced to return schema-valid content. Assembles a
   full page and **upserts into `db.json` by `videoId`**. Model resolved from env
   (`MODEL_STATS_EXTRACTOR` → `MODEL` → error; no hard-coded default, per the
   monorepo rule). This is the **only** GenAI call in the whole agent — an
   opt-in publishing tool; the transcriber pipeline stays 100% LLM-free.

3. **`db.json`** — the JSON DB: a single committed array of pages, seeded from
   four already-transcribed talks. Hand-editable; validated on every build.

4. **`build.py` + `templates/`** — the static-site generator. Pure function of
   `db.json` (no key, no network). Jinja2 → `dist/`: `index.html` (list view) +
   one **crawlable `<slug>.html` per talk**. Styled with **Tailwind (CDN)** and
   inline **Lucide** SVG icons — framework-free, **no runtime JS**, so every page
   is server-rendered and SEO/link-preview-friendly. (An earlier single-page
   hash-router variant was rejected for exactly that reason — JS-rendered content
   isn't crawlable.)

5. **`export.py`** — flattens `db.json` to `dist/stats.parquet`, one row per
   metric with page/example/speaker context denormalized plus a `watchUrl` deep
   link. Ships next to the site so the numbers are queryable with **DuckDB**,
   including remotely over HTTPS once on Pages — the same pattern job-pilot uses
   on job-scout's trends parquet. `build.py` writes it automatically when pyarrow
   is present.

6. **CI** — `.github/workflows/talk-value-stats.yml` runs the tests, builds
   `dist/` from the committed `db.json`, and deploys to **GitHub Pages**
   (`upload-pages-artifact` + `deploy-pages`) on pushes to `main` touching the
   agent. CI never runs extraction, so it needs no secret and never sees a
   transcript.

Nothing in the youtube-transcriber agent changes except removing the temporary `site/` sub-layer that was promoted here.

## Decisions taken (owner-confirmed 2026-07-24)

- **Metrics**: a uniform `metrics[]` list tagged by `category` (+ `other`
  escape hatch), not fixed named fields — real talks state numbers fixed slots
  can't hold (200 bps EBITA, 85,000 lives, 400×).
- **Page scope**: one video per page.
- **Stack**: Python + pydantic (canonical), not TypeScript/zod. The earlier
  zod prototype (`schema.ts`, `validate.ts`) was removed to avoid a dual source
  of truth.
- **Trigger**: a CLI (`extract.py`), not a REST endpoint — fits a static→Pages
  pipeline with no host to run.

## Content / privacy note — settle before committing `db.json`

The agent's `.gitignore` excludes `runs/` because **full transcripts are
verbatim third-party copyrighted speech and this repo is public**. This site
publishes only *extracted factual claims* (numbers, attributed to named public
promotional talks) with **short single-sentence quotes as evidence** — ordinary
commentary/fair-use attribution, not a transcript. `db.json` holds those quotes.

**Decision for the owner:** commit `db.json` (treat these public talks as
quotable) — or gitignore it like the transcriber's `runs/` and keep the DB
local. Defaulting to **commit**, since the point is to publish; the owner can
flip it. `dist/` is gitignored either way (CI regenerates it).

## Impact

- New: `agents/talk-value-stats/{schema.py,extract.py,build.py,export.py,
  db.json,prompts/extract.md,templates/*,README.md,pyproject.toml,.gitignore}`,
  `tests/{test_stats.py,fixtures/transcript.md}`,
  `.github/workflows/talk-value-stats.yml`.
  Published output: `index.html` + one `<slug>.html` per talk + `stats.parquet`.
- Changed: `youtube-transcriber` only loses the temporary `site/` sub-layer,
  its `[site]` pyproject extra, and one `.gitignore` line — its own code is
  untouched, and it stays LLM-free and key-free.
- Dependencies live on the new agent (`pydantic`, `jinja2`, `pyarrow`,
  `anthropic`, `python-dotenv`); a credential is needed only by `extract.py`.
- Risk: low. No runtime server, no secret in CI; the published page is static.
