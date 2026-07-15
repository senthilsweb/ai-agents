"""Eval 3 (design.md §Evals): guards abort before any paid call;
one attempt per job, no retry; sibling jobs continue past a failure."""
from pathlib import Path

import pytest

from pipeline.matcher import GuardError, HarvestError, resolve_slug, run_match, to_match
from pipeline.state import JobFact


def job(company, req="R1", platform="ashby", title="Engineering Manager"):
    return JobFact(company_name=company, ats_platform=platform,
                   req_id=req, title=title)


CFG = {"matcher": {"max_jobs_per_run": 25, "batch_size": 2},
       "slugs": {"Harvey": "harvey"}}
ENV = {"RUN_PAID_MATCH": "1",
       "JOBMATCH_API_BASE": "https://api.example.com",
       "JOBMATCH_AGENT_BASE": "https://agent.example.com"}


def rep(score=72, band="good_match"):
    return {"score_breakdown": {"total_score": score}, "match_status": band,
            "recommendation": "Good match", "cover_letter_text": "Dear team,",
            "analysis": {"gaps": ["Kubernetes", "Rust", "Go", "C", "Zig", "Ada"]}}


class Counters:
    def __init__(self, fail_harvest_for=(), fail_analyze=False):
        self.harvest_calls, self.upload_calls, self.analyze_calls = {}, 0, 0
        self.fail_harvest_for, self.fail_analyze = fail_harvest_for, fail_analyze

    def harvest(self, job, slugs):
        self.harvest_calls[job.company_name] = \
            self.harvest_calls.get(job.company_name, 0) + 1
        if job.company_name in self.fail_harvest_for:
            raise HarvestError("board is down")
        return "x" * 500

    def upload(self, base, job, text):
        self.upload_calls += 1
        return f"/uploads/{job.company_name}.txt"

    def analyze(self, base, resume, paths):
        self.analyze_calls += 1
        if self.fail_analyze:
            raise RuntimeError("api 500")
        return [rep() for _ in paths]


def run(jobs, c, env=ENV, cfg=CFG):
    return run_match(jobs, Path("/dev/null"), cfg, environ=env,
                     harvest=c.harvest, upload=c.upload, analyze=c.analyze)


def test_paid_guard_blocks_before_any_call():
    c = Counters()
    with pytest.raises(GuardError, match="RUN_PAID_MATCH"):
        run([job("A")], c, env={**ENV, "RUN_PAID_MATCH": "0"})
    assert c.harvest_calls == {} and c.upload_calls == 0 and c.analyze_calls == 0


def test_cap_aborts_before_any_paid_call():
    c = Counters()
    with pytest.raises(GuardError, match="max_jobs_per_run"):
        run([job(f"C{i}", req=f"R{i}") for i in range(26)], c)
    assert c.harvest_calls == {} and c.analyze_calls == 0


def test_one_attempt_no_retry_and_siblings_continue():
    c = Counters(fail_harvest_for={"B"})
    matches, failures = run([job("A"), job("B"), job("C")], c)
    assert all(n == 1 for n in c.harvest_calls.values())   # never retried
    assert {m.job.company_name for m in matches} == {"A", "C"}
    assert len(failures) == 1 and failures[0].job_ref.startswith("B /")
    assert "board is down" in failures[0].reason


def test_analyze_failure_marks_chunk_and_run_survives():
    c = Counters(fail_analyze=True)
    matches, failures = run([job("A"), job("B")], c)
    assert matches == [] and len(failures) == 2
    assert c.analyze_calls == 1                            # one attempt, no retry


def test_empty_candidates_short_circuits_without_guards():
    # Quiet day: no candidates -> no guard error even with RUN_PAID_MATCH=0.
    matches, failures = run([], Counters(), env={"RUN_PAID_MATCH": "0"})
    assert matches == [] and failures == []


def test_to_match_maps_fields_and_caps_missing_skills():
    m = to_match(job("A"), rep())
    assert m.total_score == 72 and m.match_band == "good_match"
    assert len(m.missing_skills) == 5                      # top-5 cap
    assert m.cover_letter == "Dear team,"


def test_resolve_slug_value_forms():
    slugs = {"Snowflake": "snowflake",
             "NVIDIA": "nvidia/NVIDIAExternalCareerSite",
             "Machinify": {"slug": "machinify", "platform": "greenhouse"}}
    assert resolve_slug("Snowflake", slugs) == ("ashby", "snowflake")
    assert resolve_slug("NVIDIA", slugs) == ("workday", "nvidia/NVIDIAExternalCareerSite")
    assert resolve_slug("Machinify", slugs) == ("greenhouse", "machinify")
    assert resolve_slug("Unknown", slugs) == (None, None)
