"""Render agent-job-matcher analyze results into a ranked HTML report.

Spec: openspec/changes/api-match-report/specs/report-renderer/spec.md

Input contract (design D2): a JSON list whose elements are either
- enriched records — job-scout metadata (company, title, location,
  apply_url, job_id, optional first_analyzed) plus a `report` key
  holding one JobReport or JobFetchFailure as the API returned it; or
- bare JobReport / JobFetchFailure objects (a raw /analyze response),
  in which case titles fall back to analysis.job_title and there is
  no apply link.

Usage:
    python tools/build_match_report.py \
        --input exports/jobmatch-20260713/all_reports.json \
        --out exports/jobmatch-20260713/match-report-v2.html
"""
import argparse
import json
import sys
from datetime import date
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = "match_report.html.j2"

BANDS = [
    ("strong_match", "Strong match", "band-strong"),
    ("good_match", "Good match", "band-good"),
    ("moderate_match", "Moderate match", "band-moderate"),
    ("weak_match", "Weak match", "band-weak"),
    ("no_match", "No match", "band-none"),
]
BAND_BY_KEY = {k: (label, cls) for k, label, cls in BANDS}
SEGMENTS = [("required_skills_score", "Required skills", "seg-req"),
            ("preferred_skills_score", "Preferred skills", "seg-pref"),
            ("experience_score", "Experience", "seg-exp"),
            ("domain_score", "Domain", "seg-dom")]


def _split(entry: dict) -> tuple[dict, dict]:
    """Return (metadata, report) for an enriched or raw entry."""
    if "report" in entry:
        return entry, entry["report"]
    return {}, entry


def _job_view(meta: dict, rep: dict, new_on: str | None) -> dict:
    a, sb = rep["analysis"], rep["score_breakdown"]
    band_label, band_cls = BAND_BY_KEY[rep["match_status"]]
    return {
        "title": (meta.get("title") or a.get("job_title") or "(untitled)").strip(),
        "company": meta.get("company") or a.get("company") or "(unknown)",
        "location": meta.get("location") or a.get("location") or "n/a",
        "apply_url": meta.get("apply_url"),
        "salary": a.get("salary_range") or "—",
        "total": sb["total_score"],
        "segments": [{"label": lbl, "cls": cls, "value": sb[key]}
                     for key, lbl, cls in SEGMENTS],
        "band_key": rep["match_status"],
        "band_label": band_label,
        "band_cls": band_cls,
        "is_new": bool(new_on) and meta.get("first_analyzed") == new_on,
        "summary": a.get("summary", ""),
        "recommendation": rep.get("recommendation", ""),
        "strengths": a.get("strengths", []),
        "gaps": a.get("gaps", []),
        "resume_improvements": a.get("resume_improvements", []),
        "experience_years_context": a.get("experience_years_context", ""),
        "ats_keywords_missing": a.get("ats_keywords_missing", []),
        "cover_letter_angle": a.get("cover_letter_angle", ""),
        "cover_letter_text": (rep.get("cover_letter_text") or "").strip(),
    }


def render(entries: list[dict], title: str, new_on: str | None = None) -> str:
    jobs, failures = [], []
    resume, model = None, None
    for entry in entries:
        meta, rep = _split(entry)
        if rep.get("fetch_status") == "ok":
            jobs.append(_job_view(meta, rep, new_on))
            resume = resume or Path(rep.get("resume_file", "")).name
            model = model or (rep.get("models") or {}).get("analyst")
        else:
            failures.append({
                "name": meta.get("title") or rep.get("job_source", "(unknown source)"),
                "reason": rep.get("reason", "no reason recorded"),
            })
    jobs.sort(key=lambda j: (-j["total"], -j["segments"][0]["value"]))

    band_counts = {}
    comp_counts = {}
    for j in jobs:
        band_counts[j["band_key"]] = band_counts.get(j["band_key"], 0) + 1
        comp_counts[j["company"]] = comp_counts.get(j["company"], 0) + 1

    env = Environment(loader=FileSystemLoader(ROOT / "templates"),
                      autoescape=select_autoescape(["html", "j2"]))
    return env.get_template(TEMPLATE).render(
        title=title,
        subtitle=(f"{len(jobs)} open postings across {len(comp_counts)} companies, "
                  f"analyzed against {resume or 'the configured resume'} "
                  f"by agent-job-matcher (analyst: {model or 'n/a'}) · "
                  f"{date.today():%d %b %Y} · ranked by total score (0–100)"),
        jobs=jobs,
        failures=failures,
        bands=[{"key": k, "label": label, "count": band_counts.get(k, 0)}
               for k, label, _ in BANDS],
        companies=[{"name": c, "count": n}
                   for c, n in sorted(comp_counts.items(), key=lambda x: -x[1])],
        top_score=jobs[0]["total"] if jobs else 0,
        footer=("Deterministic scoring by agent-job-matcher (LLM extracts evidence; "
                "code computes scores). Generated by tools/build_match_report.py."),
    )


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--input", required=True, help="analyze-results JSON path")
    p.add_argument("--out", required=True, help="output HTML path")
    p.add_argument("--title", default="Job Match Report")
    p.add_argument("--new-on", default=None,
                   help="ISO date; entries whose first_analyzed equals it get a NEW badge")
    args = p.parse_args()

    entries = json.loads(Path(args.input).read_text())
    if not isinstance(entries, list):
        print("input must be a JSON list (enriched records or raw /analyze response)",
              file=sys.stderr)
        return 2
    html = render(entries, args.title, args.new_on)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html)
    ok = sum(1 for e in entries if _split(e)[1].get("fetch_status") == "ok")
    print(f"wrote {out} — {ok} jobs, {len(entries) - ok} failures")
    return 0


if __name__ == "__main__":
    sys.exit(main())
