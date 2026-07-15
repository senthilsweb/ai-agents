"""Role filter: which new jobs become match candidates.

Spec: openspec/changes/add-job-pilot/specs/new-jobs-delta/spec.md
("Role filter reuses the owner's targets"). Three rules, all from config:

1. category in the pinned set (gate decision: Eng & Tech, Product,
   Sales & GTM); a missing category does NOT disqualify (the column is
   sparsely populated — verified 2026-07-15).
2. title matches any of the owner's title_keywords (case-insensitive
   substring).
3. base_max_usd, when present, is at or above the salary floor; absent
   salary data passes (absence is not a disqualifier).

Non-candidates still appear in the digest's new-jobs table — filtering
decides who gets a paid /analyze call, not who gets reported.
"""
import logging

from pipeline.state import JobFact

log = logging.getLogger("job_pilot.filters")


def is_candidate(job: JobFact, flt: dict) -> bool:
    if job.category and job.category not in flt["categories"]:
        return False
    title = job.title.lower()
    if not any(kw.lower() in title for kw in flt["title_keywords"]):
        return False
    floor = flt["base_salary_min_usd"]
    if job.base_max_usd is not None and job.base_max_usd < floor:
        return False
    return True


def select_candidates(new: list[JobFact], flt: dict) -> list[JobFact]:
    candidates = [j for j in new if is_candidate(j, flt)]
    log.info("filter: %d of %d new jobs are match candidates",
             len(candidates), len(new))
    return candidates
