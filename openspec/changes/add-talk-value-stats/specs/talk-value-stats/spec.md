# Spec: talk-value-stats

## ADDED Requirements

### Requirement: The schema is the single source of truth, and every metric is grounded
A pydantic v2 schema (`schema.py`) SHALL define the data model
(`TranscriptStatsPage` → `speakers[]` → `examples[]` → `metrics[]`), and the
JSON DB, the extractor's output contract, and the renderer SHALL all derive from
it. Metrics SHALL be a uniform list tagged by an 8-value `category` enum
(`productivity_gain`, `cost_savings`, `additional_revenue`, `fte_savings`,
`cycle_time`, `quality`, `scale`, `other`), not fixed named fields. Every metric
SHALL carry a verbatim `quote` and an `HH:MM:SS` `timestamp`.

#### Scenario: Ungrounded or malformed data is rejected
- **WHEN** a `db.json` entry has a metric with no quote, or a timestamp that is
  not `HH:MM:SS`, or a slug that is not kebab-case
- **THEN** validation fails loudly (the build and the tests reject it) rather
  than publishing it

#### Scenario: A number that fits no named category still has a home
- **WHEN** a talk states an outcome like "85,000 lives saved" or "200 bps EBITA"
- **THEN** it is representable as a metric under `other` / `quality` with its
  own `display`, `quote`, and `timestamp`, not dropped for lack of a fixed slot

### Requirement: Extraction is the only generative step and is schema-constrained
`extract.py` SHALL obtain the stats from a transcript via a single structured-
output model call (`client.messages.parse(output_format=ExtractedContent)`), and
this SHALL be the only GenAI call in the agent. The model SHALL return only the
judgement-heavy part (`headline`, `speakers`, `examples`); the extractor SHALL
build the `VideoSource` (id, url, title, channel, duration) itself by parsing the
transcript header, so those fields are never taken from model output.

#### Scenario: Model output is constrained to the typed shape
- **WHEN** the model responds
- **THEN** the response is validated against `ExtractedContent`, and a response
  that does not conform does not become a page (parsing returns nothing usable
  and the run exits without writing)

#### Scenario: Authoritative video identity
- **WHEN** a transcript is extracted
- **THEN** the resulting page's `videoId`, `url`, and `durationSeconds` come from
  the transcript header (regex-parsed), not from the model

### Requirement: The model is resolved from the environment
`extract.py` SHALL resolve the model id from `MODEL_STATS_EXTRACTOR`, then
`MODEL`, and SHALL exit with an actionable error if neither is set. There SHALL
be no hard-coded model default.

#### Scenario: No model configured
- **WHEN** neither `MODEL_STATS_EXTRACTOR` nor `MODEL` is set
- **THEN** the CLI exits with a message naming the variable to set, before any
  API call

### Requirement: Results are upserted into a single JSON DB
Extraction results SHALL be stored in one JSON file (`db.json`) holding an array
of pages, upserted by `videoId` — re-extracting a video SHALL replace its entry,
not duplicate it. The DB SHALL be hand-editable and SHALL validate against the
schema.

#### Scenario: Re-extraction does not duplicate
- **WHEN** the same video is extracted twice
- **THEN** `db.json` contains exactly one entry for that `videoId`, updated to
  the latest result

### Requirement: The site is multipage static HTML (SEO-friendly)
`build.py` SHALL render `db.json` to `dist/` as `index.html` (a list view) plus
one crawlable `<slug>.html` per talk. Every page's content SHALL be
**server-rendered** — present in the served HTML, not injected by JavaScript — so
it is indexable and readable without JS; any JavaScript SHALL be optional
progressive enhancement only. Rendering SHALL be a pure function of `db.json` —
no key, no network. Templates SHALL autoescape data-derived text.

#### Scenario: Every talk is a real, crawlable URL
- **WHEN** the site is built from a DB of N talks
- **THEN** `dist/` contains `index.html` and N `<slug>.html` files, each
  containing the talk's content in the served HTML (not injected by JS), and the
  list links to them with relative `./` hrefs

#### Scenario: Readable with JavaScript disabled
- **WHEN** a page is loaded with JavaScript disabled
- **THEN** the full content (header, metrics, quotes, timestamps, links) is
  present and usable; only the sticky-title fade is inert

#### Scenario: Build needs no credential
- **WHEN** `build.py` runs with no API key and no network
- **THEN** it still produces the full site from `db.json`

### Requirement: The stats are published as a DuckDB-queryable parquet
`export.py` SHALL flatten `db.json` to `dist/stats.parquet`, one row per metric,
with page/example/speaker context denormalized and a `watchUrl` deep link, so the
data is queryable with DuckDB (locally and, once on Pages, remotely over HTTPS).
Parquet generation SHALL be skipped gracefully if pyarrow is absent, without
failing the HTML build.

#### Scenario: One row per metric, queryable
- **WHEN** the parquet is built from a DB whose examples contain M metrics total
- **THEN** the parquet has M rows and columns including `category`, `value`,
  `quote`, `watchUrl`, and `primaryCompany`, and a DuckDB `GROUP BY category`
  query returns correct counts

#### Scenario: Missing pyarrow degrades gracefully
- **WHEN** `build.py` runs without pyarrow installed
- **THEN** the HTML site still builds and a message notes the parquet was skipped

### Requirement: Full transcripts are never committed; only extracted stats are
The agent SHALL commit only the extracted stats (`db.json`) and generated output;
it SHALL NOT commit full transcripts. Generated output (`dist/`) SHALL be
gitignored. `db.json` SHALL contain only short, attributed evidence quotes from
public talks.

#### Scenario: No transcript in version control
- **WHEN** the agent is committed
- **THEN** the repository contains `db.json` (extracted stats + short quotes) but
  no full transcript, and `dist/` is gitignored

### Requirement: CI publishes without a secret and without a transcript
The GitHub Actions workflow SHALL run the tests, build `dist/` from the committed
`db.json`, and deploy to GitHub Pages, WITHOUT running extraction. It SHALL NOT
require any secret and SHALL NOT process a transcript.

#### Scenario: Secret-free CI
- **WHEN** CI runs on a push that touches the agent
- **THEN** it installs deps, runs pytest, builds the site + parquet, and deploys
  to Pages, using no repository secret and reading no transcript
