"""Render the hiring-trends dashboard from a trends parquet snapshot.

Spec: openspec/changes/trends-dashboard/specs/trends-dashboard/spec.md

Usage:
    python tools/build_trends_report.py --input exports/ats_raw_trends_20260714.parquet \
        --out exports/hiring-trends-20260714.html
    ... --jd all       # embed every JD (local use; page gets heavy)
    ... --jd none      # lean page, drawer shows metadata only
    ... --jd-from exports/ats_raw_full_20260714.parquet   # explicit JD source

--jd target (default) embeds JD text only for postings whose title matches
config targets.title_keywords — the copyright-conscious, publishable build.
JD text comes from the sibling full parquet (inferred by replacing
'trends' with 'full' in the input filename) joined on company + req_id.
"""
import argparse
import json
import os
import re
import sys
from pathlib import Path

import duckdb
import jinja2
import yaml

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tools.ats_fetch import _title_matches


def load_rows(parquet: str) -> list[list]:
    con = duckdb.connect()
    rows = con.execute(f"""
        SELECT company_name, ats_platform, req_id, title, category, department,
               location, CASE WHEN work_mode = 'remote' THEN 1 ELSE 0 END,
               base_min_usd, base_max_usd, CAST(posted_date AS VARCHAR), apply_url
        FROM '{parquet}' ORDER BY company_name, title""").fetchall()
    con.close()
    # row layout consumed by the template's F map (req_id stays python-side)
    return [[r[0], r[1], (r[3] or "")[:90], r[4], r[5] or "", (r[6] or "")[:40],
             r[7], r[8], r[9], r[10], r[11] or "", i, r[2]]
            for i, r in enumerate(rows)]


def load_jds(rows: list[list], mode: str, jd_from: str,
             keywords: list[str]) -> tuple[dict, int]:
    """Index-keyed JD map per --jd mode. Rows carry req_id at [-1]."""
    if mode == "none":
        return {}, 0
    con = duckdb.connect()
    jd_by_key = {(c, r): t for c, r, t in con.execute(
        f"""SELECT company_name, req_id, jd_text FROM '{jd_from}'
            WHERE jd_text IS NOT NULL""").fetchall()}
    con.close()
    out = {}
    for row in rows:
        if mode == "target" and not _title_matches(row[2], keywords):
            continue
        text = jd_by_key.get((row[0], row[-1]))
        if text:
            out[row[11]] = text
    return out, len(out)


def render(rows, jds, jd_mode, title, stamp, keywords) -> str:
    env = jinja2.Environment(loader=jinja2.FileSystemLoader(ROOT / "templates"),
                             autoescape=False)
    companies = len({r[0] for r in rows})
    return env.get_template("trends_dashboard.html.j2").render(
        title=title, heading=title.split("—")[0].strip(), stamp=stamp,
        meta_line=(f"{len(rows):,} live postings from {companies} company job "
                   f"boards (Ashby · Greenhouse · Workday)."),
        data_json=json.dumps([r[:12] for r in rows], separators=(",", ":")),
        keywords_json=json.dumps(keywords),
        jd_json=json.dumps({str(k): v for k, v in jds.items()},
                           separators=(",", ":")),
        jd_mode=jd_mode)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--input", required=True, help="trends parquet snapshot")
    p.add_argument("--out", required=True, help="output HTML path")
    p.add_argument("--title", default="Tech Hiring Trends")
    p.add_argument("--jd", choices=["target", "all", "none"], default="target")
    p.add_argument("--jd-from", help="full parquet with jd_text "
                                     "(default: input path with trends->full)")
    p.add_argument("--no-targets", action="store_true",
                   help="embed no role keywords (public builds); the page "
                        "then reads ?roles=a,b,c from its URL instead")
    args = p.parse_args()

    cfg_path = Path(os.environ.get("JOB_SCOUT_CONFIG") or ROOT / "config.yaml")
    cfg = yaml.safe_load(cfg_path.read_text())
    keywords = [] if args.no_targets else cfg["targets"]["title_keywords"]
    m = re.search(r"(\d{4})(\d{2})(\d{2})", Path(args.input).name)
    stamp = f"{m.group(1)}-{m.group(2)}-{m.group(3)}" if m else "latest"

    rows = load_rows(args.input)
    jd_from = args.jd_from or args.input.replace("trends", "full")
    if args.jd != "none" and not Path(jd_from).exists():
        print(f"warning: {jd_from} not found — building with --jd none",
              file=sys.stderr)
        args.jd = "none"
    jds, njd = load_jds(rows, args.jd, jd_from, keywords)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render(rows, jds, args.jd, f"{args.title} — {stamp}",
                          stamp, keywords))
    print(f"wrote {out} ({out.stat().st_size / 1048576:.1f} MB) — "
          f"{len(rows)} rows, {njd} JDs embedded (--jd {args.jd})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
