"""Cover-letter PDFs on the owner's letterhead.

Specs: openspec/changes/templated-cover-letter/ (layout) on top of
add-job-pilot's email-digest spec (band threshold, slug names).
Layout mirrors sk-cover-letter-cmi-june-2026.pdf: navy name header,
teal title line, gray contact line, teal links, rule — then the letter
from the analyze response, closed by a bold-name signature with a teal
contact line. fpdf2 draws literal text — no markup interpretation, so
job-derived text cannot inject anything. Core fonts are latin-1, so
typographic characters are transliterated.
"""
import logging
import os
import re
from pathlib import Path

import yaml
from fpdf import FPDF

from pipeline.state import MatchResult

ROOT = Path(__file__).resolve().parent.parent
log = logging.getLogger("job_pilot.letters")

BAND_ORDER = ["no_match", "weak_match", "moderate_match", "good_match",
              "strong_match"]

_LATIN1_MAP = str.maketrans({
    "—": "-", "–": "-", "‘": "'", "’": "'",
    "“": '"', "”": '"', "…": "...", " ": " ",
    "•": "-",
})


def band_at_least(band: str, threshold: str) -> bool:
    return BAND_ORDER.index(band) >= BAND_ORDER.index(threshold)


def slugify(company: str, title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", f"{company} {title}".lower()).strip("-")[:120]


def _latin1(text: str) -> str:
    return text.translate(_LATIN1_MAP).encode("latin-1", "replace").decode("latin-1")


def _hex_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def load_letterhead(path: Path | None = None, environ=None) -> dict:
    environ = environ if environ is not None else os.environ
    lh = yaml.safe_load((path or ROOT / "templates" / "letterhead.yaml").read_text())
    if environ.get("LETTERHEAD_PHONE"):
        lh["contact"]["phone"] = environ["LETTERHEAD_PHONE"]
    return lh


def contact_line(lh: dict) -> str:
    c = lh["contact"]
    return " · ".join(v for v in (c.get("email"), c.get("phone"),
                                  c.get("location")) if v)


def strip_leading_contact(text: str) -> str:
    """The analyze response's letter opens with a plain contact line
    (identity from the resume); the styled header replaces it. Only
    dot-separator lines at the very top are dropped — date, Re:, and
    salutation pass through untouched."""
    lines = text.strip().splitlines()
    while lines and (not lines[0].strip() or "·" in lines[0]):
        lines.pop(0)
    return "\n".join(lines).strip()


def signature_lines(body: str, lh: dict) -> list[str]:
    """Complete the signature: add the name if the letter ends at
    'Sincerely,'; never duplicate one the API already appended."""
    tail = [ln.strip() for ln in body.splitlines() if ln.strip()][-2:]
    if tail and tail[-1].rstrip(",").lower() == "sincerely":
        return [lh["name"]]
    return []


class _LetterPDF(FPDF):
    """Plain page — the letterhead is drawn once, not per page."""


def render_cover_pdf(match: MatchResult, out_dir: Path,
                     lh: dict | None = None) -> Path:
    lh = lh or load_letterhead()
    colors = {k: _hex_rgb(v) for k, v in lh["colors"].items()}
    job = match.job
    nxt = {"new_x": "LMARGIN", "new_y": "NEXT"}

    pdf = _LetterPDF(format="letter")
    pdf.set_margins(25, 20, 25)
    pdf.set_auto_page_break(True, margin=20)
    pdf.add_page()

    # ── letterhead header ────────────────────────────────────────────
    pdf.set_font("Helvetica", "B", 17)
    pdf.set_text_color(*colors["name"])
    pdf.multi_cell(0, 8, _latin1(lh["name"].upper()), **nxt)
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(*colors["accent"])
    pdf.multi_cell(0, 5.5, _latin1(lh["title_line"]), **nxt)
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(*colors["muted"])
    pdf.multi_cell(0, 5, _latin1(contact_line(lh)), **nxt)
    pdf.set_text_color(*colors["accent"])
    pdf.multi_cell(0, 5, _latin1(" · ".join(lh["links"])), **nxt)
    pdf.ln(2)
    pdf.set_draw_color(*colors["rule"])
    pdf.set_line_width(0.4)
    pdf.line(pdf.l_margin, pdf.get_y(), pdf.w - pdf.r_margin, pdf.get_y())
    pdf.ln(6)

    # ── letter body (from the analyze response) ──────────────────────
    body = strip_leading_contact(match.cover_letter)
    pdf.set_font("Helvetica", "", 11)
    pdf.set_text_color(0)
    pdf.multi_cell(0, 6, _latin1(body), align="L", **nxt)

    # ── signature block ──────────────────────────────────────────────
    for name_line in signature_lines(body, lh):
        pdf.set_font("Helvetica", "B", 11)
        pdf.multi_cell(0, 6, _latin1(name_line), **nxt)
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(*colors["accent"])
    pdf.multi_cell(0, 5, _latin1(" · ".join(lh["signature_links"])), **nxt)

    out = out_dir / f"{slugify(job.company_name, job.title)}.pdf"
    pdf.output(str(out))
    return out


def render_all(matches: list[MatchResult], threshold: str,
               out_dir: Path) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    lh = load_letterhead()
    paths = [render_cover_pdf(m, out_dir, lh) for m in matches
             if m.cover_letter and band_at_least(m.match_band, threshold)]
    log.info("letters: %d PDFs at band >= %s (of %d matches)",
             len(paths), threshold, len(matches))
    return paths
