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
import hashlib
import json
import logging
import re
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date

try:
    import certifi
    _SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    _SSL_CTX = None  # fall back to system certs (may fail on macOS Python.org builds)

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
        "department": ((j.get("departments") or [{}])[0] or {}).get("name"),
        "apply_url": j["absolute_url"],
        "posted_date": j.get("updated_at", "")[:10],
        "description_html": j.get("content"),   # HTML-escaped; unescape before use
    } for j in d.get("jobs", [])]


def fetch_lever(org: str) -> list[dict]:
    """api.lever.co/v0/postings — public JSON."""
    d = _get(f"https://api.lever.co/v0/postings/{org}?mode=json")
    return [{
        "title": j["text"],
        "req_id": j["id"],
        "req_id_type": "lever_uuid",
        "location": (j.get("categories") or {}).get("location"),
        "department": (j.get("categories") or {}).get("department"),
        "team": (j.get("categories") or {}).get("team"),
        "employment_type": (j.get("categories") or {}).get("commitment"),
        "apply_url": j["hostedUrl"],
        "posted_date": None,
        "description_html": (j.get("description") or "") + "".join(
            f"<h3>{s.get('text', '')}</h3>{s.get('content', '')}"
            for s in (j.get("lists") or [])) + (j.get("additional") or ""),
    } for j in d]


def _ashby_graphql(org: str) -> list[dict]:
    """Fallback for boards that disable the public posting API (e.g. Lime):
    the same GraphQL endpoint the hosted job-board page uses. This type has
    no publishedAt field, so posted_date is None — age filters keep undated
    rows rather than guessing."""
    q = ("query ApiJobBoardWithTeams($organizationHostedJobsPageName: String!) "
         "{ jobBoard: jobBoardWithTeams(organizationHostedJobsPageName: "
         "$organizationHostedJobsPageName) { jobPostings { id title locationName "
         "employmentType compensationTierSummary } } }")
    d = _get("https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobBoardWithTeams",
             {"operationName": "ApiJobBoardWithTeams",
              "variables": {"organizationHostedJobsPageName": org}, "query": q})
    jb = (d.get("data") or {}).get("jobBoard") or {}
    return [{
        "title": j["title"],
        "req_id": j["id"],
        "req_id_type": "ashby_uuid",
        "location": j.get("locationName"),
        "employment_type": j.get("employmentType"),
        "apply_url": f"https://jobs.ashbyhq.com/{urllib.parse.quote(org)}/{j['id']}",
        "comp_notes": j.get("compensationTierSummary"),
        "posted_date": None,
    } for j in jb.get("jobPostings", [])]


def fetch_ashby(org: str) -> list[dict]:
    """Ashby public posting API — UUIDs are the referral req IDs. Slugs may
    contain spaces/dots/case ('Flock Safety', 'super.com') so the org is
    URL-encoded verbatim, never normalized. Falls back to the job-board
    GraphQL when the posting API 404s or returns an empty board."""
    try:
        d = _get(f"https://api.ashbyhq.com/posting-api/job-board/"
                 f"{urllib.parse.quote(org)}?includeCompensation=true")
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise
        d = {"jobs": []}
    if not d.get("jobs"):
        return _ashby_graphql(org)
    out = []
    for j in d.get("jobs", []):
        comp = (j.get("compensation") or {}).get("compensationTierSummary")
        out.append({
            "title": j["title"],
            "req_id": j["id"],
            "req_id_type": "ashby_uuid",
            "location": j.get("location"),
            "department": j.get("department"),
            "team": j.get("team"),
            "employment_type": j.get("employmentType"),
            "work_mode": "remote" if j.get("isRemote") else None,
            "apply_url": j.get("jobUrl") or j.get("applyUrl"),
            "comp_notes": comp,
            "posted_date": (j.get("publishedAt") or "")[:10],
            "description_html": j.get("descriptionHtml") or j.get("descriptionPlain"),
        })
    return out


def fetch_workday(tenant: str, site: str, host: str = "wd5", limit: int = 20,
                  search_text: str = "") -> list[dict]:
    """Workday CXS JSON endpoint — returns friendly JR req IDs."""
    url = f"https://{tenant}.{host}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs"
    d = _get(url, {"appliedFacets": {}, "limit": limit, "offset": 0,
                   "searchText": search_text})
    base = f"https://{tenant}.{host}.myworkdayjobs.com/en-US/{site}"
    jobs, skipped = [], 0
    for j in d.get("jobPostings", []):
        # One malformed posting must not sink the whole board (seen live:
        # NVIDIA postings without a title, 2026-07-19) — skip and continue.
        if not j.get("title") or not j.get("externalPath"):
            skipped += 1
            continue
        jobs.append({
            "title": j["title"],
            "req_id": (j.get("bulletFields") or [None])[0],   # e.g. JR2017180
            "req_id_type": "workday_r",
            "location": j.get("locationsText"),
            "apply_url": base + j["externalPath"],
            "posted_date": None,
            "posted_recency": j.get("postedOn"),
        })
    if skipped:
        log.warning("workday %s/%s: skipped %d posting(s) missing title/externalPath",
                    tenant, site, skipped)
    return jobs


FETCHERS = {"greenhouse": fetch_greenhouse, "lever": fetch_lever,
            "ashby": fetch_ashby, "workday": fetch_workday}


# ── Config-driven company seeding ────────────────────────────────────
# Turns config search.ats_org_slugs_by_company into company rows so Tier 1
# can run from config alone (no manual company seeding). config.yaml stays
# the single source of truth — nothing is hardcoded here.
def _infer_platform(slug: str) -> str:
    """Workday slugs are 'tenant/site' (contain '/'); single tokens default
    to Ashby. Greenhouse/Lever slugs are also single tokens, so those MUST
    use the explicit dict form {slug: <org>, platform: greenhouse|lever}."""
    return "workday" if "/" in slug else "ashby"


def _resolve_slugs(slug_overrides: dict | None) -> dict[str, tuple[str, str]]:
    """Normalize config values into name -> (platform, slug). A value is either
    a bare slug string (platform inferred) or a dict {slug/org, platform}."""
    resolved: dict[str, tuple[str, str]] = {}
    for name, val in (slug_overrides or {}).items():
        if isinstance(val, dict):
            slug = str(val.get("slug") or val.get("org") or "")
            platform = str(val.get("platform") or _infer_platform(slug)).lower()
        else:
            slug = str(val)
            platform = _infer_platform(slug)
        if slug:
            resolved[name] = (platform, slug)
    return resolved


def seed_companies(con, resolved: dict[str, tuple[str, str]]) -> int:
    """Idempotently upsert a company row (name + ats_platform) for every
    configured ATS slug. Other company fields are left for later enrichment.
    Returns the number of newly inserted companies."""
    seeded = 0
    for name, (platform, _slug) in resolved.items():
        row = con.execute("SELECT company_id, ats_platform FROM company WHERE name=?",
                          [name]).fetchone()
        if row:
            if row[1] != platform:  # keep platform in sync with config
                con.execute("UPDATE company SET ats_platform=? WHERE company_id=?",
                            [platform, row[0]])
            continue
        cid = con.execute("SELECT COALESCE(MAX(company_id),0)+1 FROM company").fetchone()[0]
        con.execute("INSERT INTO company (company_id, name, ats_platform, pipeline_status) "
                    "VALUES (?,?,?,'not_started')", [cid, name, platform])
        seeded += 1
    if seeded:
        log.info("seeded %d companies from config ats_org_slugs_by_company", seeded)
    return seeded


# ── Forgiving title matching ─────────────────────────────────────────
_SENIORITY = {"senior", "sr", "jr", "junior", "principal", "staff", "lead",
              "of", "and", "the", "a", "ii", "iii"}
_WORD = re.compile(r"[a-z0-9]+")


def _title_matches(title: str, keywords: list[str] | None) -> bool:
    """Token-overlap match replacing strict full-phrase substring. A keyword
    matches when its significant tokens (seniority/stop words dropped) appear
    in the title: all of them for 1-2 word keywords, all-but-one for longer.
    So 'Sr. Engineering Manager, Data Platform' matches 'senior engineering
    manager'."""
    if not keywords:
        return True
    tset = set(_WORD.findall((title or "").lower()))
    for kw in keywords:
        sig = [t for t in _WORD.findall(kw.lower()) if t not in _SENIORITY]
        if not sig:
            continue
        hits = sum(1 for t in sig if t in tset)
        need = len(sig) if len(sig) <= 2 else len(sig) - 1
        if hits >= need:
            return True
    return False


# ── Compensation parsing (Ashby-style summary strings) ───────────────
_NUM = re.compile(r"([\d][\d,]*\.?\d*)\s*([KkMm])?")


def _parse_comp_range(text: str) -> tuple[int | None, int | None, str]:
    """Extract (base_min, base_max, currency) from an Ashby comp summary such
    as '$165,000 – $216,562' or '$264K – $379.5K'. Returns (None, None, cur)
    when unparseable (e.g. hourly or single value). Currency is detected but
    bands are only trusted for USD by the caller (scoring divisor is USD)."""
    s = text or ""
    currency = "USD"
    if re.search(r"CA\$|C\$|CAD", s):
        currency = "CAD"
    elif "€" in s or "EUR" in s:
        currency = "EUR"
    elif "£" in s or "GBP" in s:
        currency = "GBP"
    nums = []
    for raw, suf in _NUM.findall(s):
        try:
            v = float(raw.replace(",", ""))
        except ValueError:
            continue
        if suf and suf.lower() == "k":
            v *= 1_000
        elif suf and suf.lower() == "m":
            v *= 1_000_000
        if v >= 1000:  # drop stray small numbers (hourly rates, footnotes)
            nums.append(int(v))
    if len(nums) >= 2:
        return min(nums[0], nums[1]), max(nums[0], nums[1]), currency
    return None, None, currency


# ── Open/closed verification (skills/posting-verification) ───────────
_CLOSED_SIGNALS = ("job has been closed", "no longer accepting", "position has been filled",
                   "this position is closed", "posting is no longer", "not currently accepting")


def verify_open(url: str | None) -> bool | None:
    """Per skills/posting-verification: fetch the posting and classify it.
    Returns True=open, False=closed, None=unknown (network/parse failure)."""
    if not url:
        return None
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA),
                                    timeout=15, context=_SSL_CTX) as r:
            body = r.read(60000).decode("utf-8", "ignore").lower()
    except urllib.error.HTTPError as e:
        return False if e.code in (404, 410) else None
    except Exception:
        return None
    return not any(sig in body for sig in _CLOSED_SIGNALS)


def _too_old(posted: str | None, max_age_days: int | None) -> bool:
    """True when a posting's date is known AND older than the window.
    Undated postings (Lever, Workday, Ashby-GraphQL) are always kept."""
    if not max_age_days or not posted:
        return False
    try:
        return (date.today() - date.fromisoformat(str(posted)[:10])).days > max_age_days
    except ValueError:
        return False


def fetch_all(con, keywords: list[str] | None = None,
              slug_overrides: dict | None = None, verify: bool = False,
              max_age_days: int | None = None, snapshot: bool = False) -> int:
    """Seed companies from config, then pull postings for every company with a
    known ATS + org slug.

    Seeds company rows from slug_overrides first so Tier 1 works from config
    alone. Filters titles against keywords (forgiving token match), dedups on
    (company_id, req_id), inserts with visa_sponsorship='verify'. When
    verify=True each posting's apply_url is checked (status='open'|'closed');
    otherwise status='open'. Persists a compensation row when the payload
    carries comp data. Returns number of new rows.

    max_age_days skips postings whose feed date is older than the window
    (undated feeds are kept). snapshot=True additionally marks previously
    open rows 'closed' when their req_id has left the company's live board —
    skipped for Workday (its feed is paginated, absence proves nothing).
    """
    resolved = _resolve_slugs(slug_overrides)
    seed_companies(con, resolved)
    rows = con.execute("""
        SELECT company_id, name, ats_platform FROM company
        WHERE pipeline_status IN ('not_started','alert_target','jobs_found')""").fetchall()
    inserted = 0
    for cid, name, ats in rows:
        if name not in resolved:
            continue
        platform, slug = resolved[name]
        ats = ats or platform
        fetcher = FETCHERS.get(ats)
        if not fetcher:
            log.warning("no fetcher for ats=%s (%s)", ats, name)
            continue
        try:
            jobs = fetch_workday(*slug.split("/")) if ats == "workday" else fetcher(slug)
        except Exception as e:
            log.error("fetch failed %s/%s: %s", name, ats, e)
            continue
        for j in jobs:
            if not _title_matches(j["title"], keywords):
                continue
            if _too_old(j.get("posted_date"), max_age_days):
                continue
            dup = con.execute("SELECT 1 FROM job_posting WHERE company_id=? AND req_id=?",
                              [cid, j.get("req_id")]).fetchone()
            if dup:
                continue
            status = "open"
            if verify:
                ok = verify_open(j.get("apply_url"))
                if ok is False:
                    status = "closed"          # keep row as alert target, never skip
                qh = hashlib.sha256(
                    (j.get("apply_url") or j.get("req_id") or name).encode()).hexdigest()[:16]
                con.execute("INSERT OR REPLACE INTO crawl_log VALUES (?,?,?,now(),?)",
                            [qh, name, j.get("apply_url") or "",
                             f"verify status={status} ok={ok}"])
            nid = con.execute("SELECT COALESCE(MAX(job_id),0)+1 FROM job_posting").fetchone()[0]
            con.execute("""INSERT INTO job_posting (job_id, company_id, title, location,
                work_mode, req_id, req_id_type, apply_url, posted_recency, status,
                visa_sponsorship, first_seen, last_verified)
                VALUES (?,?,?,?,?,?,?,?,?, ?, 'verify', current_date, current_date)""",
                [nid, cid, j["title"], j.get("location"), j.get("work_mode"),
                 j.get("req_id"), j.get("req_id_type"), j.get("apply_url"),
                 j.get("posted_recency") or j.get("posted_date"), status])
            comp = j.get("comp_notes")
            if comp:                            # persist comp so comp_score isn't always 0
                bmin, bmax, cur = _parse_comp_range(comp)
                con.execute("""INSERT OR REPLACE INTO compensation
                    (job_id, currency, base_min, base_max, comp_notes) VALUES (?,?,?,?,?)""",
                    [nid, cur, bmin if cur == "USD" else None,
                     bmax if cur == "USD" else None, comp])
            inserted += 1
        if snapshot and ats != "workday":
            live = [r for r in (j.get("req_id") for j in jobs) if r]
            if live:
                ph = ",".join("?" * len(live))
                gone = con.execute(
                    f"SELECT COUNT(*) FROM job_posting WHERE company_id=? "
                    f"AND status='open' AND req_id NOT IN ({ph})",
                    [cid, *live]).fetchone()[0]
                if gone:
                    con.execute(
                        f"UPDATE job_posting SET status='closed', last_verified=current_date "
                        f"WHERE company_id=? AND status='open' AND req_id NOT IN ({ph})",
                        [cid, *live])
                    log.info("%s: snapshot closed %d postings gone from board", name, gone)
        log.info("%s: %d postings fetched via %s API", name, len(jobs), ats)
    return inserted


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(name)s %(levelname)s %(message)s")
    if len(sys.argv) >= 2 and sys.argv[1] == "selftest":
        # Before/after for the forgiving title match on realistic ATS titles.
        kws = ["senior engineering manager", "data governance", "data platform architect",
               "principal solutions architect", "ai governance"]
        samples = ["Sr. Engineering Manager, Data Platform",
                   "Principal Solutions Architect - Healthcare",
                   "Staff Data Governance Program Lead",
                   "Head of AI Governance",
                   "Software Engineer II, Frontend"]
        print(f"{'title':<48} {'old(substr)':>12} {'new(token)':>12}")
        for t in samples:
            old = any(k.lower() in t.lower() for k in kws)
            print(f"{t:<48} {str(old):>12} {str(_title_matches(t, kws)):>12}")
        sys.exit(0)
    ats, org = sys.argv[1], sys.argv[2]
    extra = dict(a.split("=") for a in sys.argv[3:] if "=" in a)
    if ats == "workday":
        jobs = fetch_workday(org, extra.get("--site", extra.get("site", "External")),
                             extra.get("--host", extra.get("host", "wd5")))
    else:
        jobs = FETCHERS[ats](org)
    print(json.dumps(jobs[:10], indent=2))
