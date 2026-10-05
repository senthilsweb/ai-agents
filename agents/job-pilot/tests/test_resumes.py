"""Resume variants (openspec/changes/resume-variants): variant choice,
phone injection, table-aware text extraction, attachment selection, the
sync tool's scrub, and the guard that keeps a phone number out of this
public repo."""
import importlib.util
import io
import zipfile
from pathlib import Path

import pytest

from pipeline import resumes
from pipeline.digest import build_message, compose
from pipeline.resumes import (PHONE_PLACEHOLDER, PHONE_RE, ResumeError,
                              choose_variant, docx_text, find, render,
                              render_attachments, scoring_resume)
from pipeline.state import JobFact, MatchResult

REPO_DIR = Path(__file__).resolve().parent.parent / "inputs" / "resumes"
W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

RULES = {
    "fallback": "master",
    "rules": [
        {"variant": "eng-manager", "title_contains": ["engineering manager"]},
        {"variant": "genai-fde", "title_contains": ["forward deployed", "ai engineer"]},
        {"variant": "data-genai-fde", "title_contains": ["data platform"]},
    ],
}


def make_docx(path: Path, phone="732-555-0100", extra_part=None) -> Path:
    body = (f'<w:document {W}><w:body>'
            f'<w:p><w:r><w:t>SENTHIL</w:t></w:r></w:p>'
            f'<w:p><w:r><w:t>{phone}</w:t></w:r></w:p>'
            f'<w:tbl><w:tr>'
            f'<w:tc><w:p><w:r><w:t>Dagster</w:t></w:r></w:p></w:tc>'
            f'<w:tc><w:p><w:r><w:t>Azure AI Foundry</w:t></w:r></w:p></w:tc>'
            f'</w:tr></w:tbl>'
            f'<w:p><w:r><w:t>Closing line</w:t></w:r></w:p>'
            f'</w:body></w:document>')
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("word/document.xml", body)
        z.writestr("docProps/core.xml", "<core/>")
        if extra_part:
            z.writestr(*extra_part)
    return path


def cfg_for(tmp_path, keys=resumes.KEYS):
    d = tmp_path / "resumes"
    d.mkdir(exist_ok=True)
    for k in keys:
        make_docx(d / f"sk-resume-{k}-oct-2026.docx", phone=PHONE_PLACEHOLDER)
    return {**RULES, "dir": str(d)}


def match(title, band="good_match", company="Acme"):
    job = JobFact(company_name=company, ats_platform="ashby", req_id="1", title=title)
    return MatchResult(job=job, total_score=70, match_band=band, cover_letter="Dear")


# ── choosing ─────────────────────────────────────────────────────────
@pytest.mark.parametrize("title,expected", [
    ("Senior Engineering Manager, Platform", "eng-manager"),
    ("Forward Deployed Engineer", "genai-fde"),
    ("Staff AI Engineer", "genai-fde"),
    ("Data Platform Architect", "data-genai-fde"),
    ("Product Manager, Growth", "master"),          # no rule -> fallback
    ("Forward Deployed Engineering Manager", "eng-manager"),   # first rule wins
    ("SENIOR ENGINEERING MANAGER", "eng-manager"),  # case-insensitive
])
def test_choose_variant(title, expected):
    assert choose_variant(title, RULES) == expected


# ── files ────────────────────────────────────────────────────────────
def test_find_needs_exactly_one_file(tmp_path):
    cfg = cfg_for(tmp_path)
    assert find("genai-fde", cfg).name == "sk-resume-genai-fde-oct-2026.docx"
    make_docx(Path(cfg["dir"]) / "sk-resume-genai-fde-sep-2026.docx")
    with pytest.raises(ResumeError, match="found 2"):
        find("genai-fde", cfg)
    with pytest.raises(ResumeError, match="found 0"):
        find("nope", cfg)


def test_render_injects_phone_and_keeps_other_parts(tmp_path):
    cfg = cfg_for(tmp_path)
    out = render("master", cfg, tmp_path / "out", {"LETTERHEAD_PHONE": "201-555-0199"})
    with zipfile.ZipFile(out) as z:
        body = z.read("word/document.xml").decode()
        assert "201-555-0199" in body and PHONE_PLACEHOLDER not in body
        assert z.read("docProps/core.xml") == b"<core/>"


def test_render_escapes_the_phone_for_xml(tmp_path):
    cfg = cfg_for(tmp_path)
    out = render("master", cfg, tmp_path / "out", {"LETTERHEAD_PHONE": "1 <2> & 3"})
    with zipfile.ZipFile(out) as z:
        zipfile.ZipFile(out).testzip()
        assert "1 &lt;2&gt; &amp; 3" in z.read("word/document.xml").decode()


def test_render_without_phone_drops_the_placeholder(tmp_path, caplog):
    cfg = cfg_for(tmp_path)
    out = render("master", cfg, tmp_path / "out", {})
    with zipfile.ZipFile(out) as z:
        assert PHONE_PLACEHOLDER not in z.read("word/document.xml").decode()
    assert "LETTERHEAD_PHONE unset" in caplog.text


# ── scoring text ─────────────────────────────────────────────────────
def test_docx_text_includes_table_cells_in_order(tmp_path):
    text = docx_text(make_docx(tmp_path / "a.docx")).splitlines()
    assert text == ["SENTHIL", "732-555-0100", "Dagster | Azure AI Foundry",
                    "Closing line"]


def test_scoring_resume_is_the_master_without_the_placeholder(tmp_path):
    cfg = cfg_for(tmp_path)
    out = scoring_resume(tmp_path / "out", cfg)
    text = out.read_text()
    assert "Azure AI Foundry" in text            # table content survives
    assert PHONE_PLACEHOLDER not in text and not PHONE_RE.search(text)


# ── attachment selection ─────────────────────────────────────────────
def test_attachments_follow_band_and_dedupe_variants(tmp_path):
    cfg = cfg_for(tmp_path)
    matches = [match("Senior Engineering Manager", company="A"),
               match("Engineering Manager, Data", company="B"),   # same variant
               match("AI Engineer", company="C"),
               match("AI Engineer", band="weak_match", company="D"),  # below cut
               match("Product Manager", band="moderate_match", company="E")]
    paths, variants, fails = render_attachments(
        matches, "good_match", cfg, tmp_path / "out", {"LETTERHEAD_PHONE": "1"})
    assert [p.name for p in paths] == ["sk-resume-eng-manager-oct-2026.docx",
                                       "sk-resume-genai-fde-oct-2026.docx"]
    assert variants == {"a-senior-engineering-manager": "eng-manager",
                        "b-engineering-manager-data": "eng-manager",
                        "c-ai-engineer": "genai-fde"}
    assert fails == []


def test_missing_variant_file_becomes_a_failure_not_an_exception(tmp_path):
    cfg = cfg_for(tmp_path, keys=("master", "eng-manager"))   # genai-fde absent
    paths, variants, fails = render_attachments(
        [match("AI Engineer"), match("Engineering Manager", company="B")],
        "good_match", cfg, tmp_path / "out", {})
    assert [p.name for p in paths] == ["sk-resume-eng-manager-oct-2026.docx"]
    assert [f.node for f in fails] == ["resumes"] and fails[0].job_ref == "genai-fde"
    assert "acme-ai-engineer" not in variants        # digest won't claim it


def test_no_matches_means_no_attachments(tmp_path):
    paths, variants, fails = render_attachments(
        [], "good_match", cfg_for(tmp_path), tmp_path / "out", {})
    assert (paths, variants, fails) == ([], {}, [])


# ── email assembly ───────────────────────────────────────────────────
ENV = {"DIGEST_FROM": "a@x.com", "DIGEST_TO": "b@x.com"}


def test_docx_is_attached_with_the_word_mime_type(tmp_path):
    f = make_docx(tmp_path / "sk-resume-master-oct-2026.docx")
    pdf = tmp_path / "letter.pdf"
    pdf.write_bytes(b"%PDF-1.4")
    msg = build_message("<html/>", "s", [pdf, f], environ=ENV)
    kinds = {a.get_filename(): a.get_content_type() for a in msg.iter_attachments()}
    assert kinds == {"letter.pdf": "application/pdf",
                     "sk-resume-master-oct-2026.docx":
                     "application/vnd.openxmlformats-officedocument."
                     "wordprocessingml.document"}


def test_digest_names_the_variant_and_counts_resumes():
    m = match("AI Engineer")
    html = compose("2026-10-04", "trends/20261003", [m.job], [m.job], [m], [],
                   "good_match", variants={"acme-ai-engineer": "genai-fde"},
                   resume_count=1)
    assert "genai-fde variant" in html
    assert "1 resume attached" in html


def test_digest_without_variants_still_renders():
    m = match("AI Engineer")
    html = compose("2026-10-04", "trends/20261003", [m.job], [m.job], [m], [],
                   "good_match")
    assert "variant" not in html and "0 resumes attached" in html


# ── sync tool ────────────────────────────────────────────────────────
def load_sync():
    spec = importlib.util.spec_from_file_location(
        "sync_resumes", Path(__file__).resolve().parent.parent / "tools" / "sync_resumes.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_sync_scrubs_the_phone_everywhere(tmp_path):
    sync = load_sync()
    src = make_docx(tmp_path / "in.docx")
    out = tmp_path / "out.docx"
    out.write_bytes(sync.scrub(src))
    with zipfile.ZipFile(out) as z:
        assert PHONE_PLACEHOLDER in z.read("word/document.xml").decode()
        for n in z.namelist():
            assert not PHONE_RE.search(z.read(n).decode())


def test_sync_refuses_a_file_with_a_second_phone(tmp_path):
    sync = load_sync()
    src = make_docx(tmp_path / "in.docx",
                    extra_part=("word/footer1.xml", "call 212-555-0111"))
    with pytest.raises(SystemExit, match="left in word/footer1.xml"):
        sync.scrub(src)


def test_sync_refuses_a_file_with_no_phone(tmp_path):
    sync = load_sync()
    with pytest.raises(SystemExit, match="found 0"):
        sync.scrub(make_docx(tmp_path / "in.docx", phone="no phone here"))


# ── the repo guard: this repository is public ────────────────────────
def test_committed_resumes_are_complete_and_phone_free():
    cfg = {"dir": str(REPO_DIR)}
    for key in resumes.KEYS:
        path = find(key, cfg)
        with zipfile.ZipFile(path) as z:
            for name in z.namelist():
                assert not PHONE_RE.search(z.read(name).decode("utf-8", "ignore")), \
                    f"phone number in {path.name}:{name} — run tools/sync_resumes.py"
            assert z.read("word/document.xml").decode().count(PHONE_PLACEHOLDER) == 1


def test_committed_master_scores_with_table_content(tmp_path):
    text = scoring_resume(tmp_path, {"dir": str(REPO_DIR), "fallback": "master"}).read_text()
    for needle in ("Dagster", "Azure AI Foundry", "Pentaho", "Feb 2015"):
        assert needle in text, needle
    assert len(text.split()) > 1400      # the paragraph-only reader gets ~1,200
