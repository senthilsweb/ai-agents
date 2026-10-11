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


class GateRecord(BaseModel):
    """One job's Jev gate decision (jev-rules-gate). Facts and verdicts
    only — never job text. `rule_*` is what the string rules said,
    `jev_*` what Jev said, `candidate`/`variant` what was used."""
    job_ref: str                       # "company / title"
    slug: str
    rule_candidate: bool
    rule_variant: str
    jev_location: str | None = None
    jev_location_conf: float | None = None
    jev_role_p: float | None = None
    jev_variant: str | None = None
    jev_variant_conf: float | None = None
    jev_candidate: bool | None = None  # what Jev's answers imply
    candidate: bool = False            # what the run used
    variant: str = ""
    reason: str | None = None          # why rejected (enforce) / would be
    near_miss: bool = False
    disagree: bool = False
    error: str | None = None


class PilotState(TypedDict, total=False):
    run_date: str          # YYYY-MM-DD, injected by the entrypoint
    baseline_tag: str      # e.g. "trends/20260714", resolved by the CI wrapper
    new_jobs: list[JobFact]
    candidates: list[JobFact]
    matches: list[MatchResult]
    failures: list[Failure]
    pdf_paths: list[str]
    resume_paths: list[str]       # DOCX variants attached to the email
    resume_variants: dict[str, str]  # job slug -> variant key, for the digest
    gate: list[GateRecord]        # Jev gate records (empty when off)
    gate_stats: dict              # mode, calls, errors, tokens, cost, model
    jev_variants: dict[str, str]  # job slug -> variant chosen by Jev
    email_html: str
    send_result: str
