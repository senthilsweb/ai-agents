"""Eval 2 (design.md §Evals): golden in/out decisions for the role filter,
including the US location gate (us-location-filter spec)."""
import pytest

from pipeline.filters import is_candidate, location_bucket, select_candidates
from pipeline.state import JobFact


def job(**kw) -> JobFact:
    base = dict(company_name="X", ats_platform="ashby", req_id="R",
                title="Engineering Manager", category="Engineering & Tech")
    base.update(kw)
    return JobFact(**base)


def test_keyword_hit_in_allowed_category_is_in(flt):
    assert is_candidate(job(title="Senior Engineering Manager, Data Platform"), flt)


def test_sales_gtm_fde_is_in(flt):
    # The gate finding: FDE/SA roles are filed under Sales & GTM.
    assert is_candidate(
        job(title="Forward Deployed Engineering Manager", category="Sales & GTM"), flt)


def test_disallowed_category_is_out(flt):
    assert not is_candidate(job(category="Marketing"), flt)


def test_no_keyword_hit_is_out(flt):
    assert not is_candidate(job(title="Staff Backend Engineer"), flt)


def test_salary_below_floor_is_out(flt):
    assert not is_candidate(job(base_max_usd=180000), flt)


def test_missing_salary_passes(flt):
    assert is_candidate(job(base_max_usd=None), flt)


def test_missing_category_tolerated(flt):
    # classification/category can be empty in the parquet — not a disqualifier.
    assert is_candidate(job(category=None), flt)


@pytest.mark.parametrize("loc,bucket", [
    ("San Francisco", "us"),               # bare hub city
    ("San Francisco, CA", "us"),           # state code
    ("Irvine, California", "us"),          # full state name
    ("US-CA-Menlo Park", "us"),            # explicit US prefix
    ("Remote U.S.", "us"),                 # US marker
    ("Weirton, WV", "us"),                 # small town, state code
    ("London, UK", "non_us"),
    ("Sydney", "non_us"),
    ("Montréal - Remote", "non_us"),       # non-US wins over 'Remote'
    ("Stockholm", "non_us"),
    ("Remote", "ambiguous"),               # could be US — stays eligible
    ("North America", "ambiguous"),
    (None, "ambiguous"),
    ("Ulaanbaatar", "other"),              # unrecognized → dropped
])
def test_location_buckets(loc, bucket):
    assert location_bucket(loc) == bucket


def test_us_gate_drops_foreign_and_unknown(flt):
    assert not is_candidate(job(location="London, UK"), flt)
    assert not is_candidate(job(location="Sydney"), flt)
    assert not is_candidate(job(location="Ulaanbaatar"), flt)


def test_us_gate_keeps_us_and_remote(flt):
    assert is_candidate(job(location="New York, NY (HQ)"), flt)
    assert is_candidate(job(location="Remote"), flt)
    assert is_candidate(job(location=None), flt)


def test_us_gate_can_be_disabled(flt):
    assert is_candidate(job(location="London, UK"), {**flt, "us_only": False})


def test_select_candidates_end_to_end(flt):
    jobs = [
        job(req_id="A", title="Product Manager, AI", category="Product", base_max_usd=230000),
        job(req_id="B", title="Engineering Manager", base_max_usd=180000),   # below floor
        job(req_id="C", title="Account Executive", category="Sales & GTM"),  # no keyword
    ]
    assert [j.req_id for j in select_candidates(jobs, flt)] == ["A"]
