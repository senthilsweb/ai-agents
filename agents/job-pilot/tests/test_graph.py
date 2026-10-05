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
    "resumes": {"dir": "./inputs/resumes", "fallback": "master", "rules": []},
    "matcher": {"max_jobs_per_run": 25,
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
        "scoring_resume": track("scoring", Path("/tmp/scoring.md")),
        "render_resumes": track("resumes", ([Path("/tmp/r.docx")],
                                            {"harvey-fde": "genai-fde"}, [])),
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
    assert calls == ["fetch", "filter", "scoring", "match", "pdfs", "resumes",
                     "compose", "build", "send"]
    assert final["send_result"] == "sent"
    assert final["email_html"] == "<html>ok</html>"
    assert final["pdf_paths"] == ["/tmp/x.pdf"]
    assert final["resume_paths"] == ["/tmp/r.docx"]
    assert final["resume_variants"] == {"harvey-fde": "genai-fde"}


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

    def compose(run_date, baseline, new, cand, matches, failures, threshold, **kw):
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


def test_resume_failure_still_sends_the_email():
    """A broken resume render is reported in the digest, never fatal."""
    deps = deps_with([])

    def broken(*a, **kw):
        raise RuntimeError("resume file missing")
    deps["render_resumes"] = broken
    seen = {}
    deps["compose"] = lambda *a, **kw: seen.update(failures=a[5]) or "<html/>"
    final = invoke(deps)
    assert final["send_result"] == "sent"
    assert final["resume_paths"] == []
    assert [f.node for f in seen["failures"]] == ["resumes"]


def test_scoring_resume_failure_is_a_match_failure_not_a_crash():
    deps = deps_with([])

    def broken(*a, **kw):
        raise RuntimeError("no master resume")
    deps["scoring_resume"] = broken
    final = invoke(deps)
    assert final["send_result"] == "sent"
    assert final["matches"] == []
    assert final["failures"][0].node == "match"
