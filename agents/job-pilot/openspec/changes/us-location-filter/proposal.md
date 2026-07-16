# Proposal: us-location-filter — stop paying to analyze non-US jobs

> Status: **APPROVED** (2026-07-15, owner-requested). Owner: @senthilsweb.

## Why

The parquet's `location` column is free text (519 distinct values
today) and the role filter ignored it, so postings in London, Sydney,
or Toronto could reach the paid `/analyze` call. Each one is wasted
LLM cost — the owner only pursues US roles. Today's live dry run had a
concrete example: "Innovation Product Manager, Australia" was analyzed.

## What changes

`pipeline/filters.py` gains a `location_bucket()` heuristic (ported
from the console SQL validated live on 2026-07-15) and `is_candidate`
drops jobs whose bucket is not US when `filter.us_only: true` (new
config knob, default on):

- **us** — explicit US markers, `", XX"` state codes, full state
  names, bare hub-city names → analyzed.
- **non_us** — known foreign cities/countries/regions → dropped.
- **ambiguous** — "Remote", "North America", "Americas", empty →
  analyzed (a remote role may be US-eligible; missing one costs more
  than one analysis).
- **other** — unrecognized strings → dropped.

The safety net is unchanged: dropped jobs still appear in the digest's
new-jobs table (marked not analyzed), so a misclassified US job is
visible and can be pursued by hand.

## The durable fix, out of scope here

String heuristics have a ceiling. The ATS APIs return structured
country data that job-scout's fetcher flattens away; a future job-scout
change should emit a normalized `country` column in the parquet, and
this heuristic then collapses to `country = 'US' OR country IS NULL`.

## Impact

Touched: `pipeline/filters.py`, `config.yaml` (`filter.us_only`),
`tests/test_filters.py`, docs configuration page. Everything else
unchanged.
