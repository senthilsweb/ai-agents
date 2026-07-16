"""Typed pipeline state.

Spec: openspec/changes/add-job-pilot/design.md §Architecture.
Every node reads/writes this state; nothing else is shared between nodes.
"""
from typing import TypedDict

from pydantic import BaseModel


class JobFact(BaseModel):
    """One row of the public trends parquet (facts only — never JD text)."""
    company_name: str
    ats_platform: str
    req_id: str
    title: str
    department: str | None = None
    employment_type: str | None = None
    location: str | None = None
    work_mode: str | None = None
    comp_summary: str | None = None
    posted_date: str | None = None
    apply_url: str | None = None
    category: str | None = None
    base_min_usd: int | None = None
    base_max_usd: int | None = None


class MatchResult(BaseModel):
    """One analyze result for one job — scores and letter text, no JD."""
    job: JobFact
    total_score: int
    match_band: str
    # component points (sum ≈ total) — drive the digest's score bar
    required_skills_score: int = 0
    preferred_skills_score: int = 0
    experience_score: int = 0
    domain_score: int = 0
    recommendation: str = ""
    missing_skills: list[str] = []
    cover_letter: str = ""


class Failure(BaseModel):
    """One recorded failure — shows up in the digest's Failures section."""
    node: str
    job_ref: str      # "company / title" or "-" for run-level context
    reason: str


class PilotState(TypedDict, total=False):
    run_date: str          # YYYY-MM-DD, injected by the entrypoint
    baseline_tag: str      # e.g. "trends/20260714", resolved by the CI wrapper
    new_jobs: list[JobFact]
    candidates: list[JobFact]
    matches: list[MatchResult]
    failures: list[Failure]
    pdf_paths: list[str]
    email_html: str
    send_result: str
