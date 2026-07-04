# ADR 0001 — Deterministic-first, three-tier job discovery

- **Status**: Accepted
- **Date**: 2026-07-03
- **Scope**: `agents/job-scout` — discovery pipeline (`tools/ats_fetch.py`,
  `tools/fetch_sponsors_rainfocus.py`, `tools/load_sponsors.py`, `notebook.py`)
- **Relates to**: `openspec/specs/search-pipeline`, `openspec/specs/scoring`,
  `openspec/specs/data-model`

## Context

job-scout sources senior data-governance / engineering-leadership roles and
tracks them in DuckDB. The AI-DLC principle for this agent is **specs drive
code; typed/deterministic tools do the work; models only coordinate**. An
LLM-per-posting approach would be non-reproducible, expensive, and prone to
fabricating req IDs and salaries — the one thing `openspec/project.md`
forbids ("Never fabricate req IDs, salaries, or contacts; unknown = NULL").

Most ATS platforms (Greenhouse, Lever, Ashby, Workday) expose **public JSON
endpoints** that return structured postings with real req IDs and comp bands.
Conference sponsor catalogs (RainFocus-hosted, e.g. Databricks DAIS) expose a
paginated events API. Both can be consumed deterministically. Only genuinely
JS-rendered career sites (e.g. Phenom) need a model in the loop.

## Decision

Discovery is organised into **three tiers, cheapest reliable method first**:

1. **Tier 1 — deterministic ATS APIs (no LLM, no scraping).** `fetch_all()`
   is runnable **from config alone**: it first *seeds* a `company` row (name +
   inferred `ats_platform`) for every entry in
   `search.ats_org_slugs_by_company`, then fetches, filters, dedups, and
   inserts. `config.yaml` is the **single source of truth** for what gets
   crawled — no company seeds are hardcoded in code.
2. **Tier 2 — deterministic search plan.** Config templates × keywords ×
   pending companies emit an ordered, crawl-ledger-deduped query list for
   manual or agentic execution. No LLM required to *produce* the plan.
3. **Tier 3 — agentic fallback (LLM).** Used *only* for JS-rendered sites
   where Tiers 1–2 cannot produce structured postings, and gated behind
   `agentic.enabled` + an API key.

Supporting decisions made under this architecture:

- **Config-driven seeding, platform inferred from slug shape.** A `tenant/site`
  slug (contains `/`) is Workday; a bare token defaults to Ashby.
  Greenhouse/Lever (also bare tokens) use an explicit `{slug, platform}` dict
  form. Seeding is idempotent and only sets `name`/`ats_platform`, leaving
  other fields for enrichment.
- **Sponsor ingestion: RainFocus live API is primary.** The full paginated
  exhibitor catalog is fetched deterministically (profile id supplied at
  runtime via `.env`/CLI, never committed) and loaded through an idempotent
  loader that accepts **any** CSV path. A hand-curated CSV remains a documented
  fallback for non-RainFocus conferences; the repo ships no example seed file.
- **Enrichment without clobber.** When a sponsor matches a company already
  seeded by Tier 1, only its empty `classification`/`industry`/`company_stage`/
  `notes` fields are back-filled; existing non-empty values are never
  overwritten.
- **Verification gated by config.** `verify_before_insert` triggers a live
  open/closed check (`verify_open()`, per `skills/posting-verification`);
  closed postings are retained as alert targets, never deleted.
- **Forgiving title matching.** Keyword filtering uses token overlap (seniority
  and stop words dropped), not full-phrase substring, so "Sr. Engineering
  Manager, Data Platform" matches "senior engineering manager".
- **TLS via certifi.** urllib calls pin `certifi`'s CA bundle so fetches work
  on macOS Python.org builds that lack system certs, degrading gracefully to
  system certs when certifi is absent.

## Consequences

**Positive**

- Reproducible and auditable: identical inputs → identical rows; ~zero LLM
  tokens for the common path.
- No fabrication: req IDs and comp bands come straight from the ATS payload.
- Cheap: a full DAIS catalog (245 exhibitors) + three ATS boards cost only
  HTTP requests.
- Idempotent everywhere (crawl-ledger TTL, sponsor loader, company seeding),
  so re-runs are safe and incremental.

**Negative / trade-offs**

- Coverage is bounded by which ATS/org slugs are configured; unknown ATS fall
  to Tier 2/3.
- Deterministic verification cannot classify a *closed* JS/SPA posting (the
  page returns a 200 shell); such cases are deliberately deferred to Tier 3.
- Auto-classification of sponsors is best-effort keyword/tier heuristics; rows
  outside known heuristics are marked `unclassified` rather than guessed.
- Comp bands are trusted only when the currency is USD (the scoring divisor is
  USD); non-USD bands are stored as notes but left out of the score.

## Alternatives considered

- **LLM-per-posting extraction** — rejected: non-reproducible, costly, and
  invites fabricated identifiers/salaries.
- **HTML scraping of career pages** — rejected as the default: brittle against
  markup changes and often blocked; reserved for the Tier 3 agentic path.
- **Committing a hand-curated sponsor seed CSV** — rejected: made obsolete by
  the live RainFocus fetch + `--load`; a stale committed list drifts from
  reality.
