"""Deterministic sponsor-catalog fetch for RainFocus-hosted conferences
(e.g., Databricks Data + AI Summit). Emits a seed CSV for load_sponsors.py,
preserving the human-review gate: fetch -> review/classify CSV -> load.

Payload shape (verified against DAIS 2026 live response):
  sectionList[0].items[]  — paginated, 50/page, totalSearchItems overall
  item.attributevalues[]  — SponsorshipLevel = Legend|Icon|Visionary|
                            Innovator|Advocate|Enthusiast|Explorer|
                            Customer Activations
'Customer Activations' entries are customer showcases (booth experiences),
not hiring-relevant sponsors, and are excluded by default.

Usage:
  python tools/fetch_sponsors_rainfocus.py --profile-id <rfapiprofileid> \
      [--out exports/sponsors_full.csv] [--include-activations]
  python tools/fetch_sponsors_rainfocus.py --load                 # fetch -> classify -> load
  python tools/fetch_sponsors_rainfocus.py --from-file ex.json    # offline parse

Never commit profile IDs or cookies; pass at runtime or via env
RAINFOCUS_PROFILE_ID / RAINFOCUS_COOKIE.
"""
import argparse
import csv
import html
import json
import logging
import os
import re
import ssl
import urllib.parse
import urllib.request

try:
    from dotenv import load_dotenv
    load_dotenv()  # so RAINFOCUS_PROFILE_ID / RAINFOCUS_COOKIE resolve from .env
except ImportError:
    pass  # .env optional; CLI args still work

try:
    import certifi
    _SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    _SSL_CTX = None  # fall back to system certs (may fail on macOS Python.org builds)

log = logging.getLogger("fetch_sponsors_rainfocus")
URL = "https://events.rainfocus.com/api/exhibitors"
PAGE = 50


def _post(profile_id: str, offset: int, cookie: str | None) -> dict:
    data = urllib.parse.urlencode({"type": "exhibitor", "catalogDisplay": "list",
                                   "from": offset, "size": PAGE}).encode()
    headers = {"rfapiprofileid": profile_id,
               "Content-Type": "application/x-www-form-urlencoded"}
    if cookie:
        headers["Cookie"] = cookie
    with urllib.request.urlopen(urllib.request.Request(URL, data=data, headers=headers),
                                timeout=30, context=_SSL_CTX) as r:
        return json.load(r)


def _extract(payload: dict) -> tuple[list[dict], int | None]:
    """RainFocus returns two shapes: the first page is 'sectioned'
    (sectionList[0].items + totalSearchItems); subsequent pages are 'flat'
    (top-level items + total). Handle both so pagination doesn't stop at 50."""
    if payload.get("sectionList"):
        sec = payload["sectionList"][0]
        return sec.get("items", []), payload.get("totalSearchItems") or sec.get("total")
    return payload.get("items", []), payload.get("total")


def fetch(profile_id: str, cookie: str | None = None) -> list[dict]:
    items, offset, total = [], 0, None
    while True:
        payload = _post(profile_id, offset, cookie)
        page, page_total = _extract(payload)
        if page_total is not None:
            total = page_total
        if not page:
            break
        items.extend(page)
        offset += len(page)
        log.info("fetched %d/%s", offset, total)
        if total is not None and offset >= total:
            break
    return items


def _attr(item: dict, attribute_id: str) -> str:
    for av in item.get("attributevalues", []) or []:
        if av.get("attribute_id") == attribute_id:
            return av.get("value") or ""
    return ""


def _clean(desc: str, limit: int = 140) -> str:
    txt = html.unescape(re.sub(r"<[^>]+>", " ", desc or ""))
    txt = re.sub(r"\s+", " ", txt).strip()
    return txt[:limit]


# Deterministic classification heuristics (rule-based, not ML/LLM).
# Order matters: first match wins. Best-effort; false positives expected
# and acceptable for non-critical sourcing use cases.
_ESTABLISHED = {"aws", "amazon", "microsoft", "google", "accenture", "deloitte",
                "ey", "kpmg", "pwc", "infosys", "capgemini", "ibm", "sap", "oracle",
                "salesforce", "cisco", "nvidia", "snowflake", "servicenow", "wipro",
                "cognizant", "tcs", "hcl"}
_FRONTIER_AI = {"openai", "anthropic", "mistral", "cohere", "xai", "perplexity",
                "meta ai", "google deepmind"}
_SI_KEYWORDS = ("consulting", "systems integrat", "advisory", "solutions llc",
                "technologies pvt", "services group")
_TIER_TO_STAGE = {"legend": "public_or_large_private", "icon": "public_or_large_private"}


def classify(name: str, tier: str, notes: str) -> tuple[str, str]:
    """Return (classification, company_stage) via keyword rules on name+notes."""
    n, txt = name.lower(), (name + " " + notes).lower()
    if n in _ESTABLISHED or any(k in n for k in _ESTABLISHED):
        return "established", "public"
    if n in _FRONTIER_AI or any(k in n for k in _FRONTIER_AI):
        return "frontier_ai", "private"
    if any(k in txt for k in _SI_KEYWORDS) or n.endswith((" llc", " inc", " corp")) is False and \
       any(k in txt for k in ("system integrator", "consulting")):
        return "boutique_si", "private"
    if tier in ("legend", "icon"):
        return "established", "public"          # top tiers skew large/incumbent
    if tier in ("visionary", "innovator"):
        return "growth_startup", "private"       # mid tiers skew funded scaleups
    return "unclassified", ""                    # explorer/enthusiast/advocate: too thin a signal


def to_seed_csv(items: list[dict], out_path: str, raw_path: str | None = None,
                include_activations: bool = False, auto_classify: bool = True) -> int:
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    if raw_path:
        os.makedirs(os.path.dirname(raw_path) or ".", exist_ok=True)
        json.dump(items, open(raw_path, "w"), indent=1)
    rows, skipped = [], 0
    for it in items:
        name = (it.get("name") or "").strip()
        if not name or it.get("testRecord") or str(it.get("status", "")).lower() != "approved":
            continue
        tier = _attr(it, "SponsorshipLevel")
        if tier == "Customer Activations" and not include_activations:
            skipped += 1
            continue
        booth = ", ".join(b.get("booth", "") for b in it.get("booths", []) if b.get("booth"))
        notes = _clean(it.get("description", ""))
        tier_l = (tier or "unknown").lower()
        cls, stage = classify(name, tier_l, notes) if auto_classify else ("", "")
        rows.append({
            "name": name,
            "classification": cls,     # rule-based guess; false positives OK (non-critical use)
            "industry": "",
            "company_stage": stage,
            "tier": tier_l,
            "notes": notes,
            "website": it.get("url") or it.get("externalLink") or "",
            "linkedin": it.get("linkedinLink") or "",
            "booth": booth,
        })
    rows.sort(key=lambda r: (r["tier"], r["name"].lower()))
    with open(out_path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()) if rows else
                           ["name", "classification", "industry", "company_stage",
                            "tier", "notes", "website", "linkedin", "booth"])
        w.writeheader()
        w.writerows(rows)
    log.info("seed csv -> %s (%d sponsors, %d customer-activations skipped) — "
             "review & classify before loading", out_path, len(rows), skipped)
    return len(rows)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    p = argparse.ArgumentParser()
    p.add_argument("--profile-id", default=os.getenv("RAINFOCUS_PROFILE_ID"))
    p.add_argument("--cookie", default=os.getenv("RAINFOCUS_COOKIE"))
    p.add_argument("--from-file", help="parse a saved response JSON instead of fetching")
    p.add_argument("--out", default="exports/sponsors_full.csv")
    p.add_argument("--raw", default="exports/sponsors_raw.json")
    p.add_argument("--include-activations", action="store_true")
    p.add_argument("--no-auto-classify", action="store_true",
                   help="leave classification blank instead of rule-based guess")
    p.add_argument("--load", action="store_true",
                   help="skip the review step and load straight into DuckDB "
                        "(fine for low-stakes sourcing; classification may be imperfect)")
    p.add_argument("--db", default="job_tracker.duckdb")
    p.add_argument("--conference", default="Databricks Data + AI Summit 2026")
    p.add_argument("--organizer", default="Databricks")
    p.add_argument("--start", default="2026-06-15")
    p.add_argument("--end", default="2026-06-18")
    p.add_argument("--location", default="Moscone Center, San Francisco")
    p.add_argument("--url", default="https://www.databricks.com/dataaisummit")
    a = p.parse_args()
    if a.from_file:
        payload = json.load(open(a.from_file))
        items = (payload.get("sectionList") or [{}])[0].get("items", []) \
                if isinstance(payload, dict) else payload
    else:
        if not a.profile_id:
            raise SystemExit("profile-id required (arg or RAINFOCUS_PROFILE_ID env)")
        items = fetch(a.profile_id, a.cookie)
    n = to_seed_csv(items, a.out, a.raw, a.include_activations, not a.no_auto_classify)
    if a.load:
        from load_sponsors import load
        new_c, new_s = load(a.db, a.out, {"name": a.conference, "organizer": a.organizer,
                                          "start": a.start, "end": a.end,
                                          "location": a.location, "url": a.url})
        log.info("auto-loaded | new_companies=%d new_sponsorships=%d", new_c, new_s)
