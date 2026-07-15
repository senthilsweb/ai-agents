"""Evals for the letterhead cover-letter PDFs
(openspec/changes/templated-cover-letter/): strip/signature goldens,
no-phone contact line, band threshold, render smoke."""
import pytest

from pipeline.letters import (band_at_least, contact_line, load_letterhead,
                              render_all, render_cover_pdf, signature_lines,
                              slugify, strip_leading_contact)
from pipeline.state import JobFact, MatchResult

LH = {
    "name": "Senthilnathan Karuppaiah",
    "title_line": "Sr.Engineering Manager · Data Governance Architect",
    "contact": {"email": "me@example.com", "phone": "", "location": "NJ, USA"},
    "links": ["linkedin.com/in/x", "example.com"],
    "signature_links": ["me@example.com", "example.com"],
    "colors": {"name": "#212B36", "accent": "#0E7C86",
               "muted": "#6B7280", "rule": "#212B36"},
}

API_LETTER = (
    "\nme@example.com · 555-1234 · linkedin.com/in/x · example.com\n\n"
    "July 15, 2026\n\nRe: Engineering Manager at Harvey\n\n"
    "Dear Hiring Manager,\n\nI bring 20+ years of experience — “broadly”.\n\n"
    "Sincerely,")


def match(band="good_match", score=72, letter=API_LETTER,
          company="Harvey", title="Forward Deployed Engineering Manager"):
    return MatchResult(
        job=JobFact(company_name=company, ats_platform="ashby", req_id="R1",
                    title=title, location="Remote US"),
        total_score=score, match_band=band, cover_letter=letter)


def test_strip_removes_only_the_leading_contact_line():
    body = strip_leading_contact(API_LETTER)
    assert body.startswith("July 15, 2026")
    assert "555-1234" not in body
    assert "Re: Engineering Manager at Harvey" in body
    assert "Dear Hiring Manager," in body


def test_strip_keeps_letters_without_contact_line():
    assert strip_leading_contact("July 1, 2026\n\nDear team,") \
        .startswith("July 1, 2026")


def test_signature_appends_name_after_sincerely():
    body = strip_leading_contact(API_LETTER)
    assert signature_lines(body, LH) == ["Senthilnathan Karuppaiah"]


def test_signature_never_duplicates_api_name():
    body = "Dear team,\n\nSincerely,\nSenthilnathan Karuppaiah"
    assert signature_lines(body, LH) == []


def test_contact_line_skips_empty_phone():
    assert contact_line(LH) == "me@example.com · NJ, USA"
    with_phone = {**LH, "contact": {**LH["contact"], "phone": "555-1234"}}
    assert contact_line(with_phone) == "me@example.com · 555-1234 · NJ, USA"


def test_letterhead_phone_from_env(tmp_path):
    import yaml
    p = tmp_path / "lh.yaml"
    p.write_text(yaml.safe_dump(LH))
    lh = load_letterhead(p, environ={"LETTERHEAD_PHONE": "732-000-0000"})
    assert lh["contact"]["phone"] == "732-000-0000"


def test_committed_letterhead_has_no_phone():
    # Public repo: the phone must only ever arrive via env (spec).
    lh = load_letterhead(environ={})
    assert lh["contact"]["phone"] == ""


def test_pdf_renders_with_slug_name(tmp_path):
    out = render_cover_pdf(match(), tmp_path, LH)
    assert out.name == "harvey-forward-deployed-engineering-manager.pdf"
    assert out.read_bytes()[:5] == b"%PDF-"
    assert out.stat().st_size > 500


def test_no_score_metadata_in_pdf(tmp_path):
    # Spec: a letter must be forwardable — no bands/scores inside.
    raw = render_cover_pdf(match(), tmp_path, LH).read_bytes()
    assert b"good_match" not in raw and b"72/100" not in raw


def test_unicode_letter_does_not_crash(tmp_path):
    out = render_cover_pdf(match(letter="Résumé — “great fit”…\n\nSincerely,"),
                           tmp_path, LH)
    assert out.exists()


def test_band_threshold_selects_good_and_up(tmp_path):
    ms = [match(band="strong_match", score=85, company="A"),
          match(band="good_match", score=70, company="B"),
          match(band="moderate_match", score=55, company="C"),
          match(band="good_match", score=68, company="D", letter="")]  # no letter
    paths = render_all(ms, "good_match", tmp_path)
    assert sorted(p.name[0] for p in paths) == ["a", "b"]


def test_band_order_sane():
    assert band_at_least("strong_match", "good_match")
    assert band_at_least("good_match", "good_match")
    assert not band_at_least("moderate_match", "good_match")


def test_slugify():
    assert slugify("Monte Carlo", "Sr. Engineer (Data/AI)") == \
        "monte-carlo-sr-engineer-data-ai"
