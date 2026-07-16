"""Eval 5 (design.md §Evals, amended by digest-redesign): candidates-only
cards, counters, quiet day, failures, hostile-title autoescape,
message assembly with attachments."""
from pipeline.digest import build_message, compose, recipients, render_subject
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
                       required_skills_score=40, preferred_skills_score=12,
                       experience_score=10, domain_score=10,
                       recommendation="Worth applying.",
                       missing_skills=["Kubernetes", "Rust", "Go", "Zig"],
                       cover_letter="Dear team,")


def test_only_candidates_are_listed():
    # 3 new jobs, 1 candidate analyzed — the other 2 must not appear.
    j1 = job()
    j2 = job(company="Coder", req="R2", title="Senior Product Manager",
             location="United Kingdom")
    j3 = job(company="Alan", req="R3", title="Care Ops", location="Paris")
    html = compose("2026-07-16", "trends/20260714", [j1, j2, j3], [j1],
                   [match_for(j1)], [], "good_match")
    assert "Forward Deployed Engineering Manager" in html
    assert "Coder" not in html and "Alan" not in html
    assert "3 new postings scanned" in html
    assert "2 outside US" in html
    assert "1 matched your filter" in html


def test_cards_carry_report_anatomy():
    j = job()
    html = compose("2026-07-16", "trends/20260714", [j], [j],
                   [match_for(j, band="strong_match", score=84)], [],
                   "good_match")
    assert "84" in html and "Strong Match" in html
    assert "#0ca30c" in html                       # strong-band pill color
    assert "#2a78d6" in html and "#eda100" in html  # bar segments
    assert "Apply" in html and "jobs.ashbyhq.com" in html
    assert "Kubernetes" in html and "Zig" not in html   # top-3 gaps cap
    assert "Worth applying." in html


def test_cards_ranked_by_score():
    j1, j2 = job(), job(company="Notion", req="R2", title="Product Manager, AI")
    html = compose("2026-07-16", "trends/20260714", [j1, j2], [j1, j2],
                   [match_for(j1, score=65), match_for(j2, score=90)], [],
                   "good_match")
    assert html.index("Notion") < html.index("Harvey")


def test_quiet_day_still_composes():
    html = compose("2026-07-16", "trends/20260714", [], [], [], [], "good_match")
    assert "No new jobs matched your filter today" in html
    assert "0 postings scanned" in html


def test_failures_section():
    j = job()
    html = compose("2026-07-16", "trends/20260714", [j], [j], [],
                   [Failure(node="match", job_ref="Harvey / FDE",
                            reason="api 500")], "good_match")
    assert "Failures" in html and "api 500" in html


def test_hostile_title_is_escaped():
    hostile = job(title="<script>alert('x')</script> Engineer")
    html = compose("2026-07-16", "trends/20260714", [hostile], [hostile],
                   [match_for(hostile)], [], "good_match")
    assert "<script>alert" not in html
    assert "&lt;script&gt;" in html


def test_build_message_carries_pdfs(tmp_path):
    lh = {"name": "S K", "title_line": "T",
          "contact": {"email": "e@x.com", "phone": "", "location": "NJ"},
          "links": ["x.com"], "signature_links": ["e@x.com"],
          "colors": {"name": "#212B36", "accent": "#0E7C86",
                     "muted": "#6B7280", "rule": "#212B36"}}
    pdf = render_cover_pdf(match_for(job()), tmp_path, lh)
    msg = build_message("<html></html>", "subject x", [pdf], environ=ENV)
    assert msg["To"] == "owner@example.com"
    assert msg["Subject"] == "subject x"
    atts = list(msg.iter_attachments())
    assert len(atts) == 1
    assert atts[0].get_filename().endswith(".pdf")


def test_multiple_recipients_in_to_header():
    env = {**ENV, "DIGEST_TO": " me@x.com , spouse@y.com,, agent@z.com "}
    msg = build_message("<html></html>", "s", [], environ=env)
    assert msg["To"] == "me@x.com, spouse@y.com, agent@z.com"
    assert recipients(env["DIGEST_TO"]) == \
        ["me@x.com", "spouse@y.com", "agent@z.com"]


def test_subject_template_renders_counts():
    tpl = "[job-pilot] {matched} matches ({strong} strong) · {new} new · {date}"
    ctx = {"date": "16-Jul-2026", "new": 123, "candidates": 3,
           "matched": 3, "strong": 2, "pdfs": 3}
    assert render_subject(tpl, ctx) == \
        "[job-pilot] 3 matches (2 strong) · 123 new · 16-Jul-2026"


def test_subject_template_typo_never_blocks_send():
    assert render_subject("digest {matchez} · {date}",
                          {"date": "16-Jul-2026"}) == "digest  · 16-Jul-2026"
