"""Daily pipeline: fetch new postings, analyze new/changed JDs, render report.

Spec: openspec/changes/api-match-report/specs/daily-orchestrator/spec.md

Chains three steps and stops on the first failure (non-zero exit):
1. fetch  — Tier-1 ATS fetch (tools/ats_fetch.fetch_all) into DuckDB
2. sweep  — tools/match_sweep: analyze only new/changed open postings
3. render — tools/build_match_report over ALL analyzed jobs, with jobs
            first analyzed today badged NEW, to
            exports/jobmatch-YYYYMMDD/match-report.html

Notification is a seam only (design D8): --notify accepts 'none'.

Cron/launchd example (07:00 daily):
    0 7 * * * cd /path/to/job-scout && \
        /usr/bin/env python3 tools/daily_match.py >> logs/cron.out 2>&1
"""
import argparse
import logging
import sys
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tools import match_sweep
from tools.ats_fetch import fetch_all
from tools.build_match_report import render

log = logging.getLogger("daily_match")


def setup_logging(cfg: dict) -> Path:
    log_dir = ROOT / cfg["logging"].get("dir", "./logs")
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / f"run_{datetime.now():%Y%m%d_%H%M%S}.log"
    logging.basicConfig(
        level=cfg["logging"].get("level", "INFO"),
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
        handlers=[logging.StreamHandler(), logging.FileHandler(log_file)])
    return log_file


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--notify", default="none",
                   help="v1 accepts only 'none' (see daily-orchestrator spec)")
    p.add_argument("--skip-fetch", action="store_true",
                   help="skip Tier-1 fetch (sweep + render only)")
    args = p.parse_args()
    if args.notify != "none":
        print(f"--notify {args.notify!r} is not implemented; v1 accepts only 'none' "
              "(openspec/changes/api-match-report/specs/daily-orchestrator/spec.md)",
              file=sys.stderr)
        return 2

    cfg = match_sweep.load_config()
    log_file = setup_logging(cfg)
    con = match_sweep.connect(cfg)
    try:
        # 1. fetch — new postings into DuckDB (idempotent dedup)
        if args.skip_fetch:
            log.info("fetch skipped (--skip-fetch)")
        else:
            inserted = fetch_all(con, cfg["targets"]["title_keywords"],
                                 cfg["search"].get("ats_org_slugs_by_company"),
                                 verify=cfg["search"].get("verify_before_insert", False),
                                 max_age_days=cfg["search"].get("max_posting_age_days"),
                                 snapshot=cfg["search"].get("refresh_mode") == "snapshot",
                                 workday_max=cfg["search"].get("workday_max_postings"))
            log.info("fetch: %d new postings", inserted)

        # 2. sweep — only new/changed open postings reach the API
        stats = match_sweep.sweep(cfg, con)
        log.info("sweep: %s", stats)

        # 3. render — the full ranked picture, today's first-timers badged NEW
        entries = match_sweep.collect_entries(con)
        if not entries:
            log.error("nothing to render: api_match_result is empty "
                      "(run match_sweep.py --backfill or a first sweep)")
            return 1
        out = match_sweep.run_dir(cfg) / "match-report.html"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(render(entries, "Job Match Report — Daily",
                              new_on=date.today().isoformat()))
        new_today = sum(1 for e in entries
                        if e.get("first_analyzed") == date.today().isoformat())
        log.info("render: %d jobs (%d new today) -> %s", len(entries), new_today, out)
        print(f"report: {out} — {len(entries)} jobs, {new_today} new today, "
              f"analyzed {stats['analyzed']}, failed {stats['failed']} "
              f"(log: {log_file})")
        return 0 if stats["failed"] == 0 else 1
    finally:
        con.close()


if __name__ == "__main__":
    sys.exit(main())
