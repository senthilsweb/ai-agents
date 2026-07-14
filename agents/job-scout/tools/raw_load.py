"""Unfiltered ATS landing table + promote step.

Loads EVERY posting from every configured board into `ats_posting_raw`
(no title filter), so the role/title landscape can be explored in SQL
before deciding keywords. The matcher pipeline never reads this table —
only promoted rows in `job_posting` ever reach the paid /analyze API.

Snapshot semantics: each load replaces the rows of every company whose
board fetch SUCCEEDED (companies that errored keep their previous rows,
so one flaky board never blanks its data).

Usage:
    python tools/raw_load.py                     # full snapshot load
    python tools/raw_load.py --stats             # summarize the raw table
    python tools/raw_load.py --promote --dry-run # preview keyword promotion
    python tools/raw_load.py --promote           # promote config keyword matches
    python tools/raw_load.py --promote --where "title ILIKE '%governance%'"
    python tools/raw_load.py --promote --days 30 # only recent (or undated) rows

--where takes a SQL predicate over ats_posting_raw columns and REPLACES
the config title_keywords filter. --days keeps rows whose posted_date is
within N days or unknown. Promotion dedups on (company_id, req_id), so
re-promoting is free and never duplicates.
"""
import argparse
import hashlib
import logging
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
from html import unescape
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tools import match_sweep
from tools.ats_fetch import (FETCHERS, _parse_comp_range, _resolve_slugs,
                             _title_matches, fetch_workday, seed_companies)
from tools.match_sweep import (_ashby_job_graphql, _workday_description,
                               html_to_text)

log = logging.getLogger("raw_load")

DDL = """CREATE TABLE IF NOT EXISTS ats_posting_raw (
    company_name VARCHAR,
    ats_platform VARCHAR,
    req_id VARCHAR,
    req_id_type VARCHAR,
    title VARCHAR,
    department VARCHAR,
    team VARCHAR,
    employment_type VARCHAR,
    location VARCHAR,
    work_mode VARCHAR,
    comp_summary VARCHAR,
    posted_date DATE,
    apply_url VARCHAR,
    fetched_at TIMESTAMP,
    jd_text VARCHAR,
    jd_sha256 VARCHAR
)"""

# columns added after the first release — migrate older tables in place
MIGRATIONS = ("ALTER TABLE ats_posting_raw ADD COLUMN IF NOT EXISTS jd_text VARCHAR",
              "ALTER TABLE ats_posting_raw ADD COLUMN IF NOT EXISTS jd_sha256 VARCHAR")

COLS = ("company_name", "ats_platform", "req_id", "req_id_type", "title",
        "department", "team", "employment_type", "location", "work_mode",
        "comp_summary", "posted_date", "apply_url", "fetched_at",
        "jd_text", "jd_sha256")


def _ensure_table(con) -> None:
    con.execute(DDL)
    for m in MIGRATIONS:
        con.execute(m)


def _to_date(v) -> date | None:
    try:
        return date.fromisoformat(str(v)[:10]) if v else None
    except ValueError:
        return None


def _fetch_one(item):
    """(name, (platform, slug)) -> (name, platform, jobs|None)."""
    name, (platform, slug) = item
    fetcher = FETCHERS.get(platform)
    if not fetcher:
        log.warning("no fetcher for ats=%s (%s)", platform, name)
        return name, platform, None
    try:
        jobs = fetch_workday(*slug.split("/")) if platform == "workday" else fetcher(slug)
        return name, platform, jobs
    except Exception as e:
        log.error("fetch failed %s/%s: %s", name, platform, e)
        return name, platform, None


def _jd_text(platform: str, slug: str, j: dict) -> str | None:
    """Full JD as plain text. Ashby/Greenhouse/Lever ship it in the board
    payload; Workday and GraphQL-fallback Ashby boards need one extra
    per-job request."""
    desc = j.get("description_html")
    if desc:
        if platform == "greenhouse":       # arrives HTML-escaped
            desc = unescape(desc)
        return html_to_text(desc) or None
    try:
        if platform == "workday":
            return _workday_description(j.get("apply_url")) or None
        if platform == "ashby":            # board hides from the posting API
            body, _comp = _ashby_job_graphql(slug, j.get("req_id"))
            return body or None
    except Exception as e:
        log.warning("jd fetch failed %s %s: %s", slug, j.get("title"), e)
    return None


def load(cfg: dict, con) -> dict:
    """Snapshot-load every configured board into ats_posting_raw."""
    _ensure_table(con)
    resolved = _resolve_slugs(cfg["search"].get("ats_org_slugs_by_company"))
    now = datetime.now()
    with ThreadPoolExecutor(max_workers=8) as ex:
        results = list(ex.map(_fetch_one, resolved.items()))

        loaded, failed, rows = 0, [], []
        for name, platform, jobs in results:
            if jobs is None:
                failed.append(name)
                continue
            slug = resolved[name][1]
            texts = list(ex.map(lambda j: _jd_text(platform, slug, j), jobs))
            con.execute("DELETE FROM ats_posting_raw WHERE company_name = ?", [name])
            for j, text in zip(jobs, texts):
                sha = hashlib.sha256(text.encode()).hexdigest() if text else None
                rows.append((name, platform, j.get("req_id"), j.get("req_id_type"),
                             j.get("title"), j.get("department"), j.get("team"),
                             j.get("employment_type"), j.get("location"),
                             j.get("work_mode"), j.get("comp_notes"),
                             _to_date(j.get("posted_date")), j.get("apply_url"),
                             now, text, sha))
            loaded += 1
            log.info("%s: %d postings (raw), %d with JD text",
                     name, len(jobs), sum(1 for t in texts if t))
    if rows:
        ph = ",".join("?" * len(COLS))
        con.executemany(
            f"INSERT INTO ats_posting_raw ({','.join(COLS)}) VALUES ({ph})", rows)
    total = con.execute("SELECT COUNT(*) FROM ats_posting_raw").fetchone()[0]
    return {"companies_loaded": loaded, "companies_failed": failed,
            "rows_inserted": len(rows), "table_total": total}


def promote(cfg: dict, con, where: str | None = None, days: int | None = None,
            dry_run: bool = False) -> dict:
    """Copy selected raw rows into job_posting (dedup on company+req_id).
    Default selection = config targets.title_keywords via the forgiving
    token matcher; --where replaces that with a SQL predicate."""
    _ensure_table(con)
    resolved = _resolve_slugs(cfg["search"].get("ats_org_slugs_by_company"))
    seed_companies(con, resolved)
    sql = ("SELECT company_name, title, department, location, work_mode, req_id,"
           " req_id_type, apply_url, posted_date, comp_summary FROM ats_posting_raw")
    conds = []
    if where:
        conds.append(f"({where})")
    if days:
        conds.append(f"(posted_date IS NULL OR posted_date >= current_date - {int(days)})")
    if conds:
        sql += " WHERE " + " AND ".join(conds)
    keywords = None if where else cfg["targets"]["title_keywords"]
    cids = dict(con.execute("SELECT name, company_id FROM company").fetchall())
    picked, inserted = 0, 0
    for (name, title, _dept, loc, wm, req_id, req_type, url, posted,
         comp) in con.execute(sql).fetchall():
        if keywords is not None and not _title_matches(title, keywords):
            continue
        picked += 1
        cid = cids.get(name)
        if cid is None:
            log.warning("no company row for %s — skipped", name)
            continue
        if con.execute("SELECT 1 FROM job_posting WHERE company_id=? AND req_id=?",
                       [cid, req_id]).fetchone():
            continue
        if dry_run:
            inserted += 1
            log.info("would promote: %s — %s", name, title)
            continue
        nid = con.execute(
            "SELECT COALESCE(MAX(job_id),0)+1 FROM job_posting").fetchone()[0]
        con.execute("""INSERT INTO job_posting (job_id, company_id, title, location,
            work_mode, req_id, req_id_type, apply_url, posted_recency, status,
            visa_sponsorship, first_seen, last_verified)
            VALUES (?,?,?,?,?,?,?,?,?, 'open', 'verify', current_date, current_date)""",
            [nid, cid, title, loc, wm, req_id, req_type, url,
             str(posted) if posted else None])
        if comp:
            bmin, bmax, cur = _parse_comp_range(comp)
            con.execute("""INSERT OR REPLACE INTO compensation
                (job_id, currency, base_min, base_max, comp_notes) VALUES (?,?,?,?,?)""",
                [nid, cur, bmin if cur == "USD" else None,
                 bmax if cur == "USD" else None, comp])
        inserted += 1
    return {"matched": picked, "promoted": inserted, "dry_run": dry_run,
            "filter": where or f"title_keywords ({len(keywords or [])})"}


def test_keyword(cfg: dict, con, keyword: str) -> None:
    """Show what a candidate keyword would match in ats_posting_raw, and how
    much of that is NEW versus the current config title_keywords."""
    _ensure_table(con)
    rows = con.execute(
        "SELECT company_name, title FROM ats_posting_raw").fetchall()
    current = cfg["targets"]["title_keywords"]
    hits = [(c, t) for c, t in rows if _title_matches(t, [keyword])]
    new = [(c, t) for c, t in hits if not _title_matches(t, current)]
    print(f"keyword {keyword!r}: {len(hits)} matches, "
          f"{len(new)} NEW vs current config ({len(current)} keywords)")
    for c, t in new[:15]:
        print(f"  NEW  {c:<22} {t[:70]}")
    if len(new) > 15:
        print(f"  ... and {len(new) - 15} more")


def stats(con) -> None:
    _ensure_table(con)
    total, comps, dated = con.execute(
        """SELECT COUNT(*), COUNT(DISTINCT company_name),
           COUNT(posted_date) FROM ats_posting_raw""").fetchone()
    print(f"rows={total} companies={comps} dated={dated} undated={total - dated}")
    print("\ntop companies:")
    for n, c in con.execute("""SELECT company_name, COUNT(*) FROM ats_posting_raw
                               GROUP BY 1 ORDER BY 2 DESC LIMIT 10""").fetchall():
        print(f"  {c:>5}  {n}")
    print("\ntop departments:")
    for n, c in con.execute("""SELECT COALESCE(department,'(none)'), COUNT(*)
                               FROM ats_posting_raw GROUP BY 1 ORDER BY 2 DESC
                               LIMIT 10""").fetchall():
        print(f"  {c:>5}  {n}")


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--stats", action="store_true", help="summarize raw table")
    p.add_argument("--promote", action="store_true",
                   help="copy selected raw rows into job_posting")
    p.add_argument("--where", help="SQL predicate over ats_posting_raw "
                                   "(replaces the title_keywords filter)")
    p.add_argument("--days", type=int,
                   help="promote only rows posted within N days (or undated)")
    p.add_argument("--dry-run", action="store_true",
                   help="with --promote: preview without writing")
    p.add_argument("--test", metavar="KEYWORD",
                   help="show what a candidate keyword would match (and what's "
                        "new vs config title_keywords) — no writes")
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(name)s %(levelname)s %(message)s")
    cfg = match_sweep.load_config()
    con = match_sweep.connect(cfg)
    try:
        if args.test:
            test_keyword(cfg, con, args.test)
        elif args.stats:
            stats(con)
        elif args.promote:
            out = promote(cfg, con, args.where, args.days, args.dry_run)
            print(out)
        else:
            out = load(cfg, con)
            print(out)
            if out["companies_failed"]:
                return 1
        return 0
    finally:
        con.close()


if __name__ == "__main__":
    sys.exit(main())
