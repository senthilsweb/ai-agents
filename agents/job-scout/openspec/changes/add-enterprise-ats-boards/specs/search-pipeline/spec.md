# Spec delta: search-pipeline (add-enterprise-ats-boards)

Amends the "Three-tier discovery" requirement in
`openspec/specs/search-pipeline/spec.md`.

## Requirement: Workday host addressing in config

A Workday board SHALL be configurable entirely from its slug:
`tenant/site` for boards on the default `wd5` host, and
`tenant/site/host` for boards on any other Workday host (wd1, wd3, ...).
The fetcher SHALL pass all segments verbatim to the CXS endpoint
`https://{tenant}.{host}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs`,
and downstream JD harvesting SHALL derive tenant/host/site from each
posting's apply URL rather than from config.

#### Scenario: Non-default Workday host
- **WHEN** AVEVA is configured as `aveva/AVEVA_careers/wd3`
- **THEN** Tier 1 fetches postings from `aveva.wd3.myworkdayjobs.com` with
  no code change, and JD harvest resolves the same wd3 host from the
  apply URL

## Requirement: Companies without any ATS

A company whose careers site exposes no public job-board API (no ATS, or
an ATS with its public API disabled) SHALL NOT be force-fitted into
Tier 1 via HTML scraping (per ADR 0001). It SHALL instead be recorded in
the config's "Not loadable" comment with the date checked, leaving
discovery to Tiers 2-3.

#### Scenario: Quinnox
- **WHEN** a requested company publishes jobs only as server-rendered
  WordPress pages (no ATS tenant anywhere)
- **THEN** it is documented as not loadable rather than configured, and
  no scraper is added
