# FAQ & Design Decisions

Short answers first, then the spec that records the full reasoning.
Specs live under
[openspec/](https://github.com/senthilsweb/ai-agents/tree/main/agents/job-scout/openspec).

## Why does the public dataset exclude job descriptions?

Facts — titles, companies, locations, salary bands, dates, links — are
not copyrightable and are safe to publish. Job-description prose is the
hiring company's own text. So the public parquet carries facts only,
and JD text exists only in the local database, local exports, and
private dashboard builds for personal job-search use.
*Spec: [trends-dashboard design D3](https://github.com/senthilsweb/ai-agents/blob/main/agents/job-scout/openspec/changes/trends-dashboard/design.md).*

## Why can't the match job run by accident?

Because every selected posting is a paid API call, the cost boundary is
structural, twice over: the sweep reads only `job_posting` (promotion
is the only way in), and the container `match` job refuses to start
without `RUN_PAID_MATCH=yes`. JD hashing adds a third layer — unchanged
postings are never re-analyzed.
*Specs: [api-match-report](https://github.com/senthilsweb/ai-agents/tree/main/agents/job-scout/openspec/changes/api-match-report),
[container-runtime](https://github.com/senthilsweb/ai-agents/blob/main/agents/job-scout/openspec/changes/container-and-publishing/specs/container-runtime/spec.md).*

## Why two tables instead of one?

`ats_posting_raw` answers "what exists?" (everything, free to explore);
`job_posting` answers "what do I pursue?" (curated, feeds paid
analysis). Keeping them separate means exploration can never trigger
spend, and a bad keyword never pollutes the shortlist permanently.

## Why is there no scraping or LLM in discovery?

Every configured company exposes a public JSON API for its own job
board — the same endpoints the board's web page calls. Deterministic
APIs are free, stable, and legal-by-design; the LLM layer is an
optional fallback for the few companies without such APIs.
*Spec: [ADR 0001 — deterministic-first three-tier discovery](https://github.com/senthilsweb/ai-agents/blob/main/agents/job-scout/openspec/adr/0001-deterministic-first-three-tier-discovery.md).*

## Why "delta" refresh by default, not "snapshot"?

Delta (insert only what is new) is safe to run any number of times and
never destroys state. Snapshot mode adds closing — marking rows whose
id vanished from the live board — which is only meaningful when you
fetch complete boards regularly, and is skipped for Workday whose
paginated feed cannot prove absence.

## Why one canonical public file plus tags, instead of dated files?

One URL always serves current data; history is a git ref
(`trends/YYYYMMDD`), not a growing folder of near-duplicate files. This
halved the stored bytes per day and deleted the pruning logic. Any
day's snapshot stays fetchable forever through its tag.
*Spec: [container-and-publishing design D6](https://github.com/senthilsweb/ai-agents/blob/main/agents/job-scout/openspec/changes/container-and-publishing/design.md).*

## Why does the daily data job not use the Docker image?

On purpose. The data refresh installs four pip packages directly, so a
broken image build can never stop the data pipeline. Two small
dependency lists are the price of independent failure domains.
*Spec: [container-and-publishing design D7](https://github.com/senthilsweb/ai-agents/blob/main/agents/job-scout/openspec/changes/container-and-publishing/design.md).*

## Why do salary charts ignore some postings?

Only pay ranges companies published themselves, in USD, are parsed into
numbers. Non-USD ranges stay visible as text but are excluded from
math — converting currencies would silently mix incomparable figures.
No published range means excluded, never estimated.

## Why marimo and DuckDB instead of a web app?

Single-user tool, single-file database, zero services to operate. The
notebook gives reactive sliders for scoring; DuckDB gives real SQL over
everything, including remote parquet over https. Every output is a
self-contained HTML file for the same reason — nothing to host.

## How do changes to this project get made?

Spec-first: every change starts as an `openspec/changes/<name>/`
proposal (why, what, acceptance criteria), gets approved, then is built
in "bolts" (small shippable steps) tracked in its `tasks.md`. The
changes folder doubles as the project's decision log.
