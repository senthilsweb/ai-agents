"""Resume variants: choose, render and attach.

Spec: openspec/changes/resume-variants/. The four DOCX files in
inputs/resumes/ (the master plus the genai-fde, data-genai-fde and
eng-manager variants) are the single source of truth, synced from the
owner's resume-variant skill by tools/sync_resumes.py. This repo is
public, so they are committed with the phone number replaced by
PHONE_PLACEHOLDER; the real number is injected from LETTERHEAD_PHONE
when an attachment is rendered, exactly as for the cover letters.

The scoring text is extracted from the master DOCX here, tables
included (job-matcher's own DOCX reader skips tables, which would drop
the competencies grid and tooling lists), so what is scored can never
drift from what is attached.
"""
import logging
import os
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape

from pipeline.letters import band_at_least, slugify
from pipeline.state import Failure, MatchResult

ROOT = Path(__file__).resolve().parent.parent
log = logging.getLogger("job_pilot.resumes")

PHONE_PLACEHOLDER = "{{PHONE}}"
KEYS = ("master", "genai-fde", "data-genai-fde", "eng-manager")
DOCX_MIME = ("application", "vnd.openxmlformats-officedocument."
             "wordprocessingml.document")
_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


class ResumeError(RuntimeError):
    """A resume file is missing, ambiguous, or malformed."""


def resume_dir(cfg: dict) -> Path:
    return ROOT / cfg.get("dir", "./inputs/resumes")


def find(key: str, cfg: dict) -> Path:
    """The one committed file for a variant key. The month stays in the
    file name (sk-resume-genai-fde-oct-2026.docx), so the lookup is a
    glob and exactly one match is required."""
    hits = sorted(resume_dir(cfg).glob(f"sk-resume-{key}-*.docx"))
    if len(hits) != 1:
        raise ResumeError(f"expected exactly one sk-resume-{key}-*.docx in "
                          f"{resume_dir(cfg)}, found {len(hits)}")
    return hits[0]


def choose_variant(title: str, cfg: dict) -> str:
    """First rule whose title_contains matches wins (case-insensitive
    substring); no match means the fallback (master)."""
    low = title.lower()
    for rule in cfg.get("rules", []):
        if any(kw.lower() in low for kw in rule["title_contains"]):
            return rule["variant"]
    return cfg.get("fallback", "master")


def _replace_phone(src: Path, phone: str) -> bytes:
    """Copy the DOCX, swapping the placeholder for `phone` in the body.
    Every other part is carried over byte for byte."""
    import io
    out = io.BytesIO()
    with zipfile.ZipFile(src) as zin, \
            zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
        for info in zin.infolist():
            data = zin.read(info.filename)
            if info.filename == "word/document.xml":
                data = data.decode("utf-8").replace(
                    PHONE_PLACEHOLDER, escape(phone)).encode("utf-8")
            zout.writestr(info, data)
    return out.getvalue()


def render(key: str, cfg: dict, out_dir: Path, environ=None) -> Path:
    """One variant, phone injected, written to out_dir for attaching."""
    environ = environ if environ is not None else os.environ
    src = find(key, cfg)
    phone = environ.get("LETTERHEAD_PHONE", "")
    if not phone:
        log.warning("resumes: LETTERHEAD_PHONE unset — %s rendered "
                    "without a phone number", src.name)
    out_dir.mkdir(parents=True, exist_ok=True)
    dest = out_dir / src.name
    dest.write_bytes(_replace_phone(src, phone))
    return dest


def docx_text(path: Path) -> str:
    """Plain text of a DOCX in document order: paragraphs as lines,
    table rows as ' | '-joined cells. No dependency beyond the stdlib."""
    with zipfile.ZipFile(path) as z:
        root = ET.fromstring(z.read("word/document.xml"))

    def para(p) -> str:
        return "".join(t.text or "" for t in p.iter(f"{_W}t")).strip()

    lines: list[str] = []
    for el in root.find(f"{_W}body"):
        if el.tag == f"{_W}p":
            if text := para(el):
                lines.append(text)
        elif el.tag == f"{_W}tbl":
            for tr in el.iter(f"{_W}tr"):
                cells = [" ".join(filter(None, (para(p) for p in
                                                tc.iter(f"{_W}p"))))
                         for tc in tr.findall(f"{_W}tc")]
                if row := " | ".join(c for c in cells if c):
                    lines.append(row)
    return "\n".join(lines)


def scoring_resume(out_dir: Path, cfg: dict) -> Path:
    """The text the matcher scores: the master DOCX, extracted. The
    phone placeholder is dropped — scoring never needs it."""
    text = docx_text(find(cfg.get("fallback", "master"), cfg))
    text = text.replace(PHONE_PLACEHOLDER, "")
    out_dir.mkdir(parents=True, exist_ok=True)
    dest = out_dir / "scoring-resume.md"
    dest.write_text(text)
    return dest


def render_attachments(matches: list[MatchResult], threshold: str, cfg: dict,
                       out_dir: Path, environ=None,
                       overrides: dict[str, str] | None = None
                       ) -> tuple[list[Path], dict[str, str], list[Failure]]:
    """For every match at or above `threshold` (the same cut as the
    cover letters) pick a variant by job title. Each distinct variant is
    attached once. Returns (paths, {job slug: variant}, failures); a
    render problem becomes a Failure — it never stops the email.
    `overrides` ({slug: variant}) carries Jev's confident choices; a
    slug or an unknown key not in it falls back to the title rules."""
    overrides = overrides or {}
    chosen: dict[str, str] = {}
    for m in matches:
        if m.cover_letter and band_at_least(m.match_band, threshold):
            slug = slugify(m.job.company_name, m.job.title)
            v = overrides.get(slug)
            chosen[slug] = v if v in KEYS else choose_variant(m.job.title, cfg)
    paths: list[Path] = []
    failures: list[Failure] = []
    for key in sorted(set(chosen.values())):
        try:
            paths.append(render(key, cfg, out_dir, environ))
        except Exception as e:
            log.error("resumes: %s failed: %s", key, e)
            failures.append(Failure(node="resumes", job_ref=key, reason=str(e)))
            chosen = {s: v for s, v in chosen.items() if v != key}
    log.info("resumes: %d attached for %d matches (%s)", len(paths),
             len(chosen), ", ".join(sorted(set(chosen.values()))) or "none")
    return paths, chosen, failures


# Guard used by the sync tool and the repo's privacy test: any phone-shaped
# string left in a committed DOCX part.
PHONE_RE = re.compile(r"\(?\b\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b")
