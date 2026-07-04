"""Deterministic job fetchers for public ATS APIs. No scraping, no LLM.

Most ATS platforms expose public JSON endpoints for their job boards.
This module fetches postings directly, making stage 3 (Search + Verify)
deterministic wherever the company's ATS and org slug are known.
The agentic layer remains the fallback for companies without a known
slug or with JS-only career sites (e.g. Phenom).

Usage:
    python tools/ats_fetch.py greenhouse duckdb      # example: dbt Labs org slug
    python tools/ats_fetch.py ashby montecarlodata
    python tools/ats_fetch.py lever <org>
    python tools/ats_fetch.py workday nvidia --site NVIDIAExternalCareerSite --host wd5

Wire-in: company.ats_org_slug drives fetch_all(con) to pull every company
with pipeline_status in ('not_started','alert_target') and a known slug.
"""
import json
import logging
import ssl
import sys
import urllib.request

try:
    import certifi
    _SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    _SSL_CTX = None  # fall back to system certs

log = logging.getLogger("ats_fetch")
UA = {"User-Agent": "job-scout/1.0 (personal job search; contact in repo)"}


def _get(url: str, data: dict | None = None) -> dict:
    req = urllib.request.Request(
        url,
        data=json.dumps(data).encode() if data else None,
        headers={**UA, "Content-Type": "application/json"} if data else UA,
    )
    with urllib.request.urlopen(req, timeout=20, context=_SSL_CTX) as r:
        return json.load(r)


def fetch_greenhouse(org: str) -> list[dict]:
    """boards-api.greenhouse.io — public, stable, includes numeric req IDs."""
    d = _get(f"https://boards-api.greenhouse.io/v1/boards/{org}/jobs?content=true")
    return [{
        "title": j["title"],
        "req_id": str(j["id"]),
        "req_id_type": "greenhouse_id",
        "location": (j.get("location") or {}).get("name"),
        "apply_url": j["absolute_url"],
        "posted_date": j.get("updated_at", "")[:10],
    } for j in d.get("jobs", [])]


def fetch_lever(org: str) -> list[dict]:
    """api.lever.co/v0/postings — public JSON."""
    d = _get(f"https://api.lever.co/v0/postings/{org}?mode=json")
    return [{
        "title": j["text"],
        "req_id": j["id"],
        "req_id_type": "lever_uuid",
        "location": (j.get("categories") or {}).get("location"),
        "apply_url": j["hostedUrl"],
        "posted_date": None,
    } for j in d]


def fetch_ashby(org: str) -> list[dict]:
    """Ashby public posting API — UUIDs are the referral req IDs."""
    d = _get(f"https://api.ashbyhq.com/posting-api/job-board/{org}?includeCompensation=true")
    out = []
    for j in d.get("jobs", []):
        comp = (j.get("compensation") or {}).get("compensationTierSummary")
        out.append({
            "title": j["title"],
            "req_id": j["id"],
            "req_id_type": "ashby_uuid",
            "location": j.get("location"),
            "work_mode": "remote" if j.get("isRemote") else None,
            "apply_url": j.get("jobUrl") or j.get("applyUrl"),
            "comp_notes": comp,
            "posted_date": (j.get("publishedAt") or "")[:10],
        })
    return out


def fetch_workday(tenant: str, site: str, host: str = "wd5", limit: int = 20,
                  search_text: str = "") -> list[dict]:
    """Workday CXS JSON endpoint — returns friendly JR req IDs."""
    url = f"https://{tenant}.{host}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs"
    d = _get(url, {"appliedFacets": {}, "limit": limit, "offset": 0,
                   "searchText": search_text})
    base = f"https://{tenant}.{host}.myworkdayjobs.com/en-US/{site}"
    return [{
        "title": j["title"],
        "req_id": (j.get("bulletFields") or [None])[0],   # e.g. JR2017180
        "req_id_type": "workday_r",
        "location": j.get("locationsText"),
        "apply_url": base + j["externalPath"],
        "posted_date": None,
        "posted_recency": j.get("postedOn"),
    } for j in d.get("jobPostings", [])]


FETCHERS = {"greenhouse": fetch_greenhouse, "lever": fetch_lever,
            "ashby": fetch_ashby, "workday": fetch_workday}


def fetch_all(con, keywords: list[str] | None = None,
              slug_overrides: dict[str, str] | None = None) -> int:
    """Pull postings for every company with a known ATS + org slug.

    Filters titles against keywords (config targets.title_keywords),
    dedups on (company_id, req_id), inserts with visa_sponsorship='verify'
    and status='open'. Returns number of new rows.
    """
    slug_overrides = slug_overrides or {}
    rows = con.execute("""
        SELECT company_id, name, ats_platform FROM company
        WHERE pipeline_status IN ('not_started','alert_target','jobs_found')""").fetchall()
    inserted = 0
    for cid, name, ats in rows:
        slug = slug_overrides.get(name)
        if not slug:
            continue
        fetcher = FETCHERS.get(ats)
        if not fetcher:
            log.warning("no fetcher for ats=%s (%s)", ats, name)
            continue
        try:
            jobs = fetcher(slug) if ats != "workday" else fetch_workday(*slug.split("/"))
        except Exception as e:
            log.error("fetch failed %s/%s: %s", name, ats, e)
            continue
        for j in jobs:
            if keywords and not any(k.lower() in j["title"].lower() for k in keywords):
                continue
            dup = con.execute("SELECT 1 FROM job_posting WHERE company_id=? AND req_id=?",
                              [cid, j.get("req_id")]).fetchone()
            if dup:
                continue
            nid = con.execute("SELECT COALESCE(MAX(job_id),0)+1 FROM job_posting").fetchone()[0]
            con.execute("""INSERT INTO job_posting (job_id, company_id, title, location,
                work_mode, req_id, req_id_type, apply_url, posted_recency, status,
                visa_sponsorship, first_seen, last_verified)
                VALUES (?,?,?,?,?,?,?,?,?, 'open', 'verify', current_date, current_date)""",
                [nid, cid, j["title"], j.get("location"), j.get("work_mode"),
                 j.get("req_id"), j.get("req_id_type"), j.get("apply_url"),
                 j.get("posted_recency") or j.get("posted_date")])
            inserted += 1
        log.info("%s: %d postings fetched via %s API", name, len(jobs), ats)
    return inserted


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(name)s %(levelname)s %(message)s")
    ats, org = sys.argv[1], sys.argv[2]
    extra = dict(a.split("=") for a in sys.argv[3:] if "=" in a)
    if ats == "workday":
        jobs = fetch_workday(org, extra.get("--site", extra.get("site", "External")),
                             extra.get("--host", extra.get("host", "wd5")))
    else:
        jobs = FETCHERS[ats](org)
    print(json.dumps(jobs[:10], indent=2))
