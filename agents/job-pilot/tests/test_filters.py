"""Eval 2 (design.md §Evals): golden in/out decisions for the role filter."""
from pipeline.filters import is_candidate, select_candidates
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


def test_select_candidates_end_to_end(flt):
    jobs = [
        job(req_id="A", title="Product Manager, AI", category="Product", base_max_usd=230000),
        job(req_id="B", title="Engineering Manager", base_max_usd=180000),   # below floor
        job(req_id="C", title="Account Executive", category="Sales & GTM"),  # no keyword
    ]
    assert [j.req_id for j in select_candidates(jobs, flt)] == ["A"]
