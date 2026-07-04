"""Idempotent conference-sponsor loader. Deterministic; takes any CSV path.

The sponsor list is produced by tools/fetch_sponsors_rainfocus.py (live
RainFocus API — the primary path) or hand-curated for non-RainFocus
conferences, then loaded here. This loader makes the ingestion reproducible
and idempotent; it has no hardcoded input path.

Usage:
  python tools/load_sponsors.py exports/sponsors_full.csv \
      --conference "Databricks Data + AI Summit 2026" \
      --organizer Databricks --start 2026-06-15 --end 2026-06-18 \
      --location "Moscone Center, San Francisco" \
      --url https://www.databricks.com/dataaisummit
"""
import argparse
import csv
import logging

import duckdb

log = logging.getLogger("load_sponsors")


def load(db: str, csv_path: str, conf: dict) -> tuple[int, int]:
    con = duckdb.connect(db)
    row = con.execute("SELECT conference_id FROM conference WHERE name=?",
                      [conf["name"]]).fetchone()
    if row:
        conf_id = row[0]
    else:
        conf_id = con.execute("SELECT COALESCE(MAX(conference_id),0)+1 FROM conference").fetchone()[0]
        con.execute("INSERT INTO conference VALUES (?,?,?,?,?,?,?)",
                    [conf_id, conf["name"], conf["organizer"], conf["start"],
                     conf["end"], conf["location"], conf["url"]])
        log.info("conference created id=%s %s", conf_id, conf["name"])

    new_companies = new_links = enriched = 0
    for r in csv.DictReader(open(csv_path)):
        c = con.execute("SELECT company_id FROM company WHERE name=?", [r["name"]]).fetchone()
        if c:
            cid = c[0]
            # Back-fill only genuinely empty fields from the sponsor row so a
            # company already seeded by another tier (e.g. Tier 1 ATS seeding,
            # which sets just name+ats_platform) gains classification/industry/
            # stage/notes — without ever clobbering an existing non-empty value.
            fields = ("industry", "company_stage", "classification", "notes")
            cur = con.execute(f"SELECT {', '.join(fields)} FROM company WHERE company_id=?",
                              [cid]).fetchone()
            updates = {f: (r.get(f) or "").strip()
                       for i, f in enumerate(fields)
                       if not (cur[i] or "").strip() and (r.get(f) or "").strip()}
            if updates:
                con.execute(f"UPDATE company SET {', '.join(f'{f}=?' for f in updates)} "
                            "WHERE company_id=?", [*updates.values(), cid])
                enriched += 1
        else:
            cid = con.execute("SELECT COALESCE(MAX(company_id),0)+1 FROM company").fetchone()[0]
            con.execute("""INSERT INTO company (company_id,name,industry,company_stage,
                           classification,pipeline_status,notes) VALUES (?,?,?,?,?,'not_started',?)""",
                        [cid, r["name"], r["industry"], r["company_stage"],
                         r["classification"], r.get("notes", "")])
            new_companies += 1
        if not con.execute("SELECT 1 FROM sponsorship WHERE conference_id=? AND company_id=?",
                           [conf_id, cid]).fetchone():
            con.execute("INSERT INTO sponsorship VALUES (?,?,?,?)",
                        [conf_id, cid, r["tier"], f"seed csv: {csv_path}"])
            new_links += 1
    con.close()
    log.info("loaded | new_companies=%d new_sponsorships=%d enriched_existing=%d",
             new_companies, new_links, enriched)
    return new_companies, new_links


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    p = argparse.ArgumentParser()
    p.add_argument("csv_path")
    p.add_argument("--db", default="job_tracker.duckdb")
    p.add_argument("--conference", required=True)
    p.add_argument("--organizer", default=None)
    p.add_argument("--start", default=None)
    p.add_argument("--end", default=None)
    p.add_argument("--location", default=None)
    p.add_argument("--url", default=None)
    a = p.parse_args()
    load(a.db, a.csv_path, {"name": a.conference, "organizer": a.organizer,
                            "start": a.start, "end": a.end,
                            "location": a.location, "url": a.url})
