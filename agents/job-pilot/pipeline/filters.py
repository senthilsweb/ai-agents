"""Role filter: which new jobs become match candidates.

Specs: openspec/changes/add-job-pilot/specs/new-jobs-delta/spec.md
("Role filter reuses the owner's targets") and
agents/job-pilot/openspec/changes/us-location-filter/. Four rules:

1. category in the pinned set (gate decision: Eng & Tech, Product,
   Sales & GTM); a missing category does NOT disqualify (the column is
   sparsely populated — verified 2026-07-15).
2. location is US or ambiguous-remote when `us_only` is on — known
   foreign places and unrecognized strings never reach a paid call.
   String heuristic only until job-scout's parquet grows a normalized
   country column (see the change proposal).
3. title matches any of the owner's title_keywords (case-insensitive
   substring).
4. base_max_usd, when present, is at or above the salary floor; absent
   salary data passes (absence is not a disqualifier).

Non-candidates still appear in the digest's new-jobs table — filtering
decides who gets a paid /analyze call, not who gets reported.
"""
import logging
import re

from pipeline.state import JobFact

log = logging.getLogger("job_pilot.filters")

_US_MARKERS = re.compile(r"(?i)united states|\bU\.?S\.?A?\b|^US[-, ]")
_US_STATE_CODE = re.compile(
    r",\s?(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|"
    r"MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|"
    r"UT|VT|VA|WA|WV|WI|WY)\b")
_US_STATE_NAME = re.compile(
    r"(?i)california|new york|texas|washington|colorado|massachusetts|"
    r"illinois|georgia|florida|virginia|oregon|arizona|utah|nevada|"
    r"pennsylvania|north carolina|tennessee|minnesota|michigan|ohio")
_US_CITY = re.compile(
    r"(?i)^(san francisco|nyc|seattle|austin|boston|chicago|los angeles|"
    r"palo alto|menlo park|mountain view|sunnyvale|san jose|denver|atlanta|"
    r"miami|dallas|bellevue|irvine|washington,? d\.?c)")
_NON_US = re.compile(
    r"(?i)london|singapore|toronto|vancouver|canada|montr[eé]al|paris|"
    r"dublin|berlin|munich|amsterdam|india|bangalore|bengaluru|hyderabad|"
    r"tokyo|osaka|sydney|melbourne|australia|tel aviv|\btlv\b|zurich|"
    r"warsaw|poland|stockholm|copenhagen|oslo|helsinki|seoul|korea|"
    r"bucharest|milan|madrid|barcelona|lisbon|dubai|manchester|edinburgh|"
    r"\buk\b|united kingdom|ireland|france|germany|netherlands|japan|"
    r"brazil|mexico|argentina|colombia|philippines|vietnam|china|hong kong|"
    r"taiwan|europe|emea|apac|latam")
_REMOTE_OK = re.compile(r"(?i)\bremote\b|north america|\bnamer\b|americas|anywhere")


def location_bucket(location: str | None) -> str:
    """'us' | 'non_us' | 'ambiguous' | 'other'. Order matters: a string
    with a US state code wins over a foreign word later in it, and
    'Montréal - Remote' must classify non_us before the remote check."""
    if not location or not location.strip():
        return "ambiguous"
    if (_US_MARKERS.search(location) or _US_STATE_CODE.search(location)
            or _US_STATE_NAME.search(location) or _US_CITY.search(location)):
        return "us"
    if _NON_US.search(location):
        return "non_us"
    if _REMOTE_OK.search(location):
        return "ambiguous"
    return "other"


def is_candidate(job: JobFact, flt: dict) -> bool:
    if job.category and job.category not in flt["categories"]:
        return False
    if flt.get("us_only", True) and \
            location_bucket(job.location) in ("non_us", "other"):
        return False
    title = job.title.lower()
    if not any(kw.lower() in title for kw in flt["title_keywords"]):
        return False
    floor = flt["base_salary_min_usd"]
    if job.base_max_usd is not None and job.base_max_usd < floor:
        return False
    return True


def select_candidates(new: list[JobFact], flt: dict) -> list[JobFact]:
    candidates = [j for j in new if is_candidate(j, flt)]
    if flt.get("us_only", True):
        dropped = sum(1 for j in new
                      if location_bucket(j.location) in ("non_us", "other"))
        log.info("filter: %d of %d new jobs are match candidates "
                 "(%d dropped by the US location gate)",
                 len(candidates), len(new), dropped)
    else:
        log.info("filter: %d of %d new jobs are match candidates",
                 len(candidates), len(new))
    return candidates
