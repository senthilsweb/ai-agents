"""Eval 5 (design.md §Evals): digest HTML — sections, quiet day,
failures, hostile-title autoescape; message assembly with attachments."""
from pipeline.digest import build_message, compose
from pipeline.letters import render_cover_pdf
from pipeline.state import Failure, JobFact, MatchResult

ENV = {"DIGEST_FROM": "pilot@example.com", "DIGEST_TO": "owner@example.com"}


def job(company="Harvey", req="R1", title="Forward Deployed Engineering Manager",
        **kw):
    base = dict(company_name=company, ats_platform="ashby", req_id=req,
                title=title, location="Remote US", base_min_usd=240000,
                base_max_usd=280000,
                apply_url="https://jobs.ashbyhq.com/harvey/r1")
    base.update(kw)
    return JobFact(**base)


def match_for(j, band="good_match", score=72):
    return MatchResult(job=j, total_score=score, match_band=band,
                       recommendation="Worth applying.",
                       missing_skills=["Kubernetes", "Rust", "Go", "Zig"],
                       cover_letter="Dear team,")


def test_full_digest_has_all_sections():
    j1, j2 = job(), job(company="Notion", req="R2", title="Product Manager, AI")
    html = compose("2026-07-15", "trends/20260714", [j1, j2], [j1], [match_for(j1)],
                   [Failure(node="match", job_ref="Notion / PM", reason="api 500")],
                   "good_match")
    assert "New jobs today" in html
    assert "Matched — cover letters attached" in html
    assert "Failures" in html and "api 500" in html
    assert "good match" in html and "72/100" in html
    assert "Kubernetes" in html and "Zig" not in html      # top-3 cap
    assert "$240k" in html and "$280k" in html
    assert "2 new postings" in html


def test_quiet_day_still_composes():
    html = compose("2026-07-15", "trends/20260714", [], [], [], [], "good_match")
    assert "No new matching jobs today" in html
    assert "0 new postings" in html


def test_hostile_title_is_escaped():
    hostile = job(title="<script>alert('x')</script> Engineer")
    html = compose("2026-07-15", "trends/20260714", [hostile], [], [], [],
                   "good_match")
    assert "<script>alert" not in html
    assert "&lt;script&gt;" in html


def test_below_threshold_match_listed_but_not_attached():
    j = job()
    html = compose("2026-07-15", "trends/20260714", [j], [j],
                   [match_for(j, band="moderate_match", score=55)], [],
                   "good_match")
    assert "moderate match" in html
    assert "Matched — cover letters attached" not in html


def test_build_message_carries_pdfs(tmp_path):
    pdf = render_cover_pdf(match_for(job()), tmp_path)
    msg = build_message("<html></html>", "2026-07-15", [pdf], environ=ENV)
    assert msg["To"] == "owner@example.com"
    assert "[job-pilot] daily digest — 2026-07-15" == msg["Subject"]
    atts = list(msg.iter_attachments())
    assert len(atts) == 1
    assert atts[0].get_filename().endswith(".pdf")
