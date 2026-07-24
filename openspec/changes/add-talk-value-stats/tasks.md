# Tasks: add-talk-value-stats

> Status tracked here; the proposal is the design of record.
> All paths relative to `agents/talk-value-stats/` unless noted.

## Schema (pydantic v2, canonical)
- [x] `schema.py` — `TranscriptStatsPage` + `Person`/`Metric`/`Example`/
      `VideoSource`/`ExtractedContent`; speakers, slug, per-example speakerName;
      `schemaVersion: 2`; grounded quote + timestamp; `StatsDB` TypeAdapter.

## Data (JSON DB)
- [x] `db.json` — single array, 4 seeded talks with speakers.

## Extraction (GenAI, CLI)
- [x] `prompts/extract.md` — config-loaded extraction prompt.
- [x] `extract.py` — transcript → `messages.parse(ExtractedContent)` → assemble
      page (authoritative VideoSource from header) → upsert `db.json`; model from
      env (`MODEL_STATS_EXTRACTOR` → `MODEL` → error); transcripts from the
      sibling `youtube-transcriber/runs/` (override `$TRANSCRIBER_RUNS`).

## Static site + parquet
- [x] `templates/` — `base`, `index` (list), `detail` (blog page). No JS (SEO).
- [x] `build.py` — `db.json` → `dist/` (page per talk + calls export for parquet).
- [x] `export.py` — `db.json` → `stats.parquet` (one row per metric; DuckDB-ready).
- [x] `README.md` — pipeline, install, extract, build, DuckDB, deploy.

## Agent packaging / CI
- [x] `pyproject.toml` (pydantic, jinja2, pyarrow, anthropic, python-dotenv; dev: pytest, duckdb).
- [x] `.gitignore` — `dist/`, `.venv`, `.env`, `__pycache__`.
- [x] `.github/workflows/talk-value-stats.yml` — test → build → GitHub Pages.
- [x] Promoted out of `youtube-transcriber/site/`; removed its `[site]` extra +
      `.gitignore` line so the transcriber stays LLM-free / dependency-light.

## Docs (repo standard)
- [x] `openspec/changes/add-talk-value-stats/` completed to the OpenSpec
      standard: `proposal.md`, `design.md` (incl. Security baseline),
      `tasks.md`, `specs/talk-value-stats/spec.md`, `.openspec.yaml`
      (status + approval).
- [x] `AGENTS.md` — talk-value-stats section; `README.md` — full agent doc.

## Tests / gate
- [x] `tests/test_stats.py` + `tests/fixtures/transcript.md` — db validates,
      extractor assembly + upsert dedupe, helpers, build, parquet export. No
      network/model/key. Committed fixture (no dependency on gitignored runs/).
- [x] Rendered list + detail verified at mobile width; parquet DuckDB-queried.
- [x] **Decided (owner, 2026-07-24): `db.json` IS committed** (short attributed
      quotes of public talks = fair-use). `dist/` stays gitignored.
- [ ] Live `extract.py` run against a real transcript with a key (owner's
      credential + tokens; the non-LLM assembly path is tested, the model call is not).
- [ ] Owner: enable Pages once (Settings → Pages → Source = GitHub Actions). No commit needed.
