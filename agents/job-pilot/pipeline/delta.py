"""New-jobs delta: stateless anti-join of two parquet snapshots.

Spec: openspec/changes/add-job-pilot/specs/new-jobs-delta/spec.md.
DuckDB reads the URLs (or local paths, in tests) directly — no file is
ever written and no database exists outside process memory.
"""
import logging

import duckdb

from pipeline.state import JobFact

log = logging.getLogger("job_pilot.delta")

# Columns JobFact carries; posted_date cast so pydantic gets a string.
_COLS = ("company_name, ats_platform, req_id, title, department, "
         "employment_type, location, work_mode, comp_summary, "
         "CAST(posted_date AS VARCHAR) AS posted_date, apply_url, "
         "category, base_min_usd, base_max_usd")


def new_jobs(latest: str, baseline: str) -> list[JobFact]:
    """Rows present in `latest` but not in `baseline`, by (company, req_id)."""
    con = duckdb.connect()
    cur = con.execute(
        f"""
        SELECT {_COLS}
        FROM read_parquet(?) t
        ANTI JOIN read_parquet(?) y USING (company_name, req_id)
        ORDER BY company_name, title
        """,
        [latest, baseline],
    )
    names = [d[0] for d in cur.description]
    rows = [dict(zip(names, r)) for r in cur.fetchall()]
    con.close()
    jobs = [JobFact(**{k: v for k, v in r.items() if v is not None}) for r in rows]
    log.info("delta: %d new jobs (latest=%s baseline=%s)", len(jobs), latest, baseline)
    return jobs
