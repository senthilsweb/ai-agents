"""Digest email: compose (Jinja2, autoescape) and send (Gmail SMTP).

Spec: openspec/changes/add-job-pilot/specs/email-digest/spec.md — one
email per run, always: new-jobs table / matched with letters attached /
failures; a quiet day still sends a short email.
"""
import logging
import os
import smtplib
from email.message import EmailMessage
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

from pipeline.letters import band_at_least
from pipeline.state import Failure, JobFact, MatchResult

ROOT = Path(__file__).resolve().parent.parent
log = logging.getLogger("job_pilot.digest")

_env = Environment(loader=FileSystemLoader(ROOT / "templates"),
                   autoescape=select_autoescape(["html", "j2"]))


def _salary(job: JobFact) -> str:
    if job.base_min_usd and job.base_max_usd:
        return f"${job.base_min_usd//1000}k–${job.base_max_usd//1000}k"
    if job.base_max_usd:
        return f"up to ${job.base_max_usd//1000}k"
    return job.comp_summary or ""


def compose(run_date: str, baseline_tag: str, new_jobs: list[JobFact],
            candidates: list[JobFact], matches: list[MatchResult],
            failures: list[Failure], threshold: str) -> str:
    """Candidates only (digest-redesign spec): analyzed jobs as ranked
    cards, the rest of the delta appears solely in the counter line."""
    from datetime import date

    from pipeline.filters import location_bucket
    display_date = date.fromisoformat(run_date).strftime("%d-%b-%Y")
    cards = [{"m": m, "salary": _salary(m.job)}
             for m in sorted(matches, key=lambda m: -m.total_score)]
    attached = [m for m in matches
                if m.cover_letter and band_at_least(m.match_band, threshold)]
    n_outside_us = sum(1 for j in new_jobs
                       if location_bucket(j.location) in ("non_us", "other"))
    return _env.get_template("digest.html.j2").render(
        run_date=run_date, display_date=display_date,
        baseline_tag=baseline_tag, cards=cards,
        matches=matches, failures=failures, pdf_count=len(attached),
        n_new=len(new_jobs), n_candidates=len(candidates),
        n_outside_us=n_outside_us)


class _SafeCtx(dict):
    """Unknown placeholders render empty — a template typo must never
    block the send (email-recipients-subject spec)."""
    def __missing__(self, key):
        log.warning("subject template: unknown placeholder {%s}", key)
        return ""


def render_subject(template: str, ctx: dict) -> str:
    return template.format_map(_SafeCtx(ctx))


def recipients(value: str) -> list[str]:
    """Comma-separated DIGEST_TO -> trimmed address list."""
    return [a.strip() for a in value.split(",") if a.strip()]


def build_message(html: str, subject: str, pdf_paths: list[Path],
                  environ=None) -> EmailMessage:
    environ = environ if environ is not None else os.environ
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = environ["DIGEST_FROM"]
    msg["To"] = ", ".join(recipients(environ["DIGEST_TO"]))
    msg.set_content("This digest is HTML — open in an HTML-capable client.")
    msg.add_alternative(html, subtype="html")
    for p in pdf_paths:
        msg.add_attachment(p.read_bytes(), maintype="application",
                           subtype="pdf", filename=p.name)
    return msg


def send(msg: EmailMessage, environ=None) -> str:
    """Gmail SMTP (gate decision). A send failure raises — the run must
    go red; a digest that silently never arrives defeats the design."""
    environ = environ if environ is not None else os.environ
    host, port = environ["SMTP_HOST"], int(environ.get("SMTP_PORT", "587"))
    with smtplib.SMTP(host, port, timeout=60) as s:
        s.starttls()
        s.login(environ["SMTP_USER"], environ["SMTP_PASS"])
        s.send_message(msg)
    log.info("digest sent to %s (%d attachments)", msg["To"],
             len(list(msg.iter_attachments())))
    return f"sent to {msg['To']}"
