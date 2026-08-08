# Proposal: add-enterprise-ats-boards

**Status:** PROPOSED 2026-08-07 (implemented same session per owner request:
"create openspec change then start the implementation, test local and all
good deploy")

## Why

The owner wants four more employers in the Tier-1 deterministic fetch:
HPE, Quinnox, AVEVA, and Cohesity. None were configured, and none are on
Ashby — the platform most of the current list uses — so each needed an
ATS investigation (which board system, which org slug/tenant) before it
could be added to `search.ats_org_slugs_by_company`.

## What changes

1. **Three new Workday boards in config** (`config.yaml`) — verified live
   against the public CXS JSON endpoint on 2026-08-07:
   - **HPE** → `hpe/Jobsathpe` (host wd5, 1,073 postings). The visible
     careers site (careers.hpe.com) is Phenom, but every posting's apply
     URL resolves to `hpe.wd5.myworkdayjobs.com/Jobsathpe` and the CXS
     endpoint is open — so HPE is a plain Workday entry, no Phenom
     fetcher needed.
   - **AVEVA** → `aveva/AVEVA_careers/wd3` (246 postings). First
     configured company on a non-default Workday host (wd3), which makes
     the previously implicit host support config-addressable.
   - **Cohesity** → `cohesity/Cohesity_Careers` (host wd5, 209 postings).
     Their AEM careers page proxies Workday server-side
     (`/bin/cohesity/open-positions`); the `gh_jid` param in their page
     JS is a Greenhouse leftover — the Greenhouse board 404s.
2. **Workday slug form extended to `tenant/site/host`** — documentation
   only. `fetch_workday(*slug.split("/"))` already forwards a third slug
   segment as the host argument (in both `ats_fetch.fetch_all` and
   `raw_load._fetch_one`), and `match_sweep._workday_description` already
   parses the host out of the apply URL. The config comment,
   `_infer_platform` docstring, and `docs/configuration.md` now state the
   three-part form; the search-pipeline spec gains the requirement.
3. **Quinnox documented as not Tier-1-loadable.** Quinnox runs no ATS:
   jobs are hand-published WordPress/Elementor pages under
   `quinnox.com/career/<slug>/` (server-rendered, no job post type in the
   WP REST API, Cloudflare-guarded), and its `quinnox.keka.com` /
   `quinnox.zohorecruit.com` tenants are both dead (TenantNotFound /
   "Page does not exist", checked 2026-08-07). ADR 0001 explicitly
   rejects HTML scraping for Tier 1, so Quinnox joins the "not loadable"
   config comment and is left to the Tier-3 agentic fallback.

## Out of scope

- A Phenom fetcher (HPE turned out not to need one; no other configured
  company is Phenom-only).
- A bespoke Quinnox HTML scraper — rejected by ADR 0001; revisit only if
  Quinnox adopts an ATS. Yield would also be near zero: its ~30 openings
  are Calypso/SAP/.NET delivery roles that don't match the configured
  title keywords.
- Workday pagination. `fetch_workday` still reads one page (limit 20,
  the CXS maximum) per run, the accepted NVIDIA-precedent behavior; the
  daily delta run accumulates new reqs over time.

## Acceptance criteria

1. `python tools/ats_fetch.py workday hpe site=Jobsathpe`,
   `... workday aveva site=AVEVA_careers host=wd3`, and
   `... workday cohesity site=Cohesity_Careers` each print real postings
   with `req_id_type: workday_r`.
2. `raw_load.load()` on a fresh database with only the three new
   companies configured inserts >0 rows for each (the daily-trends CI
   path).
3. `fetch_all()` on a copy of the live database seeds the three company
   rows and inserts only title-keyword matches, deduped on
   (company_id, req_id).
4. The next scheduled trends run (`job-scout-trends.yml`) picks the
   companies up from config with no code change.
