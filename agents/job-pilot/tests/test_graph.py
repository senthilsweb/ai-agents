"""Eval 6 (design.md §Evals): graph wiring — node order, both branches of
the conditional edge, failure accumulation into the digest."""
from pathlib import Path

import pytest

from pipeline.graph import build_graph
from pipeline.matcher import GuardError
from pipeline.state import Failure, JobFact, MatchResult

CFG = {
    "parquet": {"url_template": "https://x/{ref}/t.parquet"},
    "filter": {"categories": [], "title_keywords": [], "base_salary_min_usd": 0},
    "matcher": {"resume_path": "./inputs/resume.md", "max_jobs_per_run": 25,
                "batch_size": 5, "pdf_band_threshold": "good_match"},
    "email": {"subject_prefix": "[job-pilot]"},
    "slugs": {},
}
JOB = JobFact(company_name="Harvey", ats_platform="ashby", req_id="R1",
              title="Forward Deployed Engineering Manager")
MATCH = MatchResult(job=JOB, total_score=72, match_band="good_match",
                    cover_letter="Dear team,")


def deps_with(calls, *, new=(JOB,), cand="same", matches=(MATCH,), fails=()):
    def track(name, ret):
        def fn(*a, **kw):
            calls.append(name)
            return ret
        return fn
    cand_list = list(new) if cand == "same" else list(cand)
    return {
        "new_jobs": track("fetch", list(new)),
        "select_candidates": track("filter", cand_list),
        "run_match": track("match", (list(matches), list(fails))),
        "render_all": track("pdfs", [Path("/tmp/x.pdf")]),
        "compose": track("compose", "<html>ok</html>"),
        "build_message": track("build", object()),
        "send": track("send", "sent"),
    }


def invoke(deps):
    graph = build_graph(CFG, deps=deps, environ={})
    return graph.invoke({"run_date": "2026-07-15",
                         "baseline_tag": "trends/20260714", "failures": []})


def test_happy_path_order_and_state():
    calls = []
    final = invoke(deps_with(calls))
    assert calls == ["fetch", "filter", "match", "pdfs", "compose", "build", "send"]
    assert final["send_result"] == "sent"
    assert final["email_html"] == "<html>ok</html>"
    assert final["pdf_paths"] == ["/tmp/x.pdf"]


def test_quiet_day_skips_match_and_pdfs():
    calls = []
    final = invoke(deps_with(calls, new=(), cand=()))
    assert calls == ["fetch", "filter", "compose", "build", "send"]
    assert final["send_result"] == "sent"
    assert "matches" not in final or final.get("matches") == []


def test_match_failures_reach_compose():
    seen = {}
    fail = Failure(node="match", job_ref="Harvey / FDE", reason="board down")
    deps = deps_with([], matches=(), fails=(fail,))

    def compose(run_date, baseline, new, cand, matches, failures, threshold):
        seen["failures"] = failures
        return "<html></html>"
    deps["compose"] = compose
    invoke(deps)
    assert seen["failures"] == [fail]


def test_guard_error_fails_the_run():
    deps = deps_with([])

    def guarded(*a, **kw):
        raise GuardError("RUN_PAID_MATCH != 1")
    deps["run_match"] = guarded
    with pytest.raises(GuardError):
        invoke(deps)


def test_fetch_failure_fails_the_run():
    deps = deps_with([])

    def broken(*a, **kw):
        raise RuntimeError("parquet unreachable")
    deps["new_jobs"] = broken
    with pytest.raises(RuntimeError, match="parquet unreachable"):
        invoke(deps)
