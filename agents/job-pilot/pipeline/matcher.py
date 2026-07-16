"""Match runner: harvest JD text live, upload it, call the deployed
job-matcher API — exactly one attempt per job, no retry.

Spec: openspec/changes/add-job-pilot/specs/match-runner/spec.md.
Harvest logic ported from job-scout tools/match_sweep.py (Ashby GraphQL
per job, Greenhouse board content=true, Workday cxs endpoint), with a
host allowlist and size caps added per design.md §Security baseline.
JD text lives only in process memory — it is never written locally,
logged, or committed.
"""
import json
import logging
import mimetypes
import os
import re
import ssl
import urllib.parse
import urllib.request
import uuid
from html import unescape
from pathlib import Path

from pipeline.state import Failure, JobFact, MatchResult

log = logging.getLogger("job_pilot.matcher")

UA = {"User-Agent": "job-pilot/0.1 (+github.com/senthilsweb/ai-agents)"}
_SSL_CTX = ssl.create_default_context()

ALLOWED_HOSTS = {"api.ashbyhq.com", "jobs.ashbyhq.com", "boards-api.greenhouse.io"}
ALLOWED_SUFFIXES = (".myworkdayjobs.com",)
JD_MIN_CHARS = 200          # JS-shell / empty-body guard (job-matcher's rule)
JD_MAX_CHARS = 100_000      # cap before upload
RESP_MAX_BYTES = 20_000_000  # board JSON can be large; still bounded


class GuardError(RuntimeError):
    """Aborts the run before any paid call (cap or RUN_PAID_MATCH)."""


class HarvestError(RuntimeError):
    """One job's JD could not be harvested — recorded, never retried."""


def _check_host(url: str, extra_hosts: set[str]) -> None:
    host = urllib.parse.urlparse(url).hostname or ""
    if host in ALLOWED_HOSTS or host in extra_hosts \
            or host.endswith(ALLOWED_SUFFIXES):
        return
    raise HarvestError(f"host not on allowlist: {host}")


def _get_json(url: str, payload: dict | None = None,
              extra_hosts: set[str] = frozenset()) -> dict:
    _check_host(url, extra_hosts)
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode() if payload else None,
        headers={**UA, "Content-Type": "application/json"} if payload else UA)
    with urllib.request.urlopen(req, timeout=30, context=_SSL_CTX) as r:
        return json.loads(r.read(RESP_MAX_BYTES))


def html_to_text(html: str) -> str:
    text = re.sub(r"<(br|/p|/div|/li|/h[1-6])[^>]*>", "\n", html or "", flags=re.I)
    text = re.sub(r"<li[^>]*>", "- ", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = text.replace("&amp;", "&").replace("&nbsp;", " ").replace("&#39;", "'") \
               .replace("&quot;", '"').replace("&lt;", "<").replace("&gt;", ">")
    return re.sub(r"[ \t]+", " ", re.sub(r"\n{3,}", "\n\n", text)).strip()


# ── slug resolution (same value forms as job-scout config) ──────────
def resolve_slug(company: str, slugs: dict) -> tuple[str | None, str | None]:
    """Returns (platform, slug). Bare string = Ashby; 'tenant/site' =
    Workday; dict {slug, platform} = explicit."""
    v = slugs.get(company)
    if v is None:
        return None, None
    if isinstance(v, dict):
        return v.get("platform", "ashby"), v["slug"]
    if "/" in v:
        return "workday", v
    return "ashby", v


# ── per-job JD harvest ───────────────────────────────────────────────
_gh_board_cache: dict[str, dict] = {}


def _ashby_jd(slug: str, req_id: str) -> str:
    q = ("query ApiJobPosting($organizationHostedJobsPageName: String!, "
         "$jobPostingId: String!) { jobPosting(organizationHostedJobsPageName: "
         "$organizationHostedJobsPageName, jobPostingId: $jobPostingId) "
         "{ id title descriptionHtml compensationTierSummary } }")
    d = _get_json("https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting",
                  {"operationName": "ApiJobPosting",
                   "variables": {"organizationHostedJobsPageName": slug,
                                 "jobPostingId": req_id}, "query": q})
    jp = (d.get("data") or {}).get("jobPosting")
    if not jp:
        raise HarvestError(f"ashby graphql returned no posting for {slug}/{req_id}")
    return html_to_text(jp.get("descriptionHtml") or "")


def _greenhouse_jd(slug: str, req_id: str) -> str:
    if slug not in _gh_board_cache:
        d = _get_json(f"https://boards-api.greenhouse.io/v1/boards/"
                      f"{urllib.parse.quote(slug)}/jobs?content=true")
        _gh_board_cache[slug] = {str(j["id"]): j.get("content") or ""
                                 for j in d.get("jobs", [])}
    content = _gh_board_cache[slug].get(req_id)
    if not content:
        raise HarvestError(f"greenhouse board {slug} has no job {req_id}")
    return html_to_text(unescape(content))   # content arrives HTML-escaped


def _workday_jd(apply_url: str) -> str:
    m = re.match(r"https://([^.]+)\.([^.]+)\.myworkdayjobs\.com/en-US/([^/]+)(/.*)",
                 apply_url or "")
    if not m:
        raise HarvestError(f"unrecognized workday apply_url: {apply_url}")
    tenant, host, site, path = m.groups()
    d = _get_json(f"https://{tenant}.{host}.myworkdayjobs.com/wday/cxs/{tenant}/{site}{path}")
    return html_to_text((d.get("jobPostingInfo") or {}).get("jobDescription") or "")


def harvest_jd(job: JobFact, slugs: dict) -> str:
    """One attempt. Raises HarvestError on any failure or a too-short body."""
    _, slug = resolve_slug(job.company_name, slugs)
    if job.ats_platform == "ashby":
        if not slug:
            raise HarvestError(f"no board slug configured for {job.company_name}")
        text = _ashby_jd(slug, job.req_id)
    elif job.ats_platform == "greenhouse":
        if not slug:
            raise HarvestError(f"no board slug configured for {job.company_name}")
        text = _greenhouse_jd(slug, job.req_id)
    elif job.ats_platform == "workday":
        text = _workday_jd(job.apply_url or "")
    else:
        raise HarvestError(f"unsupported ats_platform: {job.ats_platform}")
    if len(text) < JD_MIN_CHARS:
        raise HarvestError(f"JD too short ({len(text)} chars) — likely a JS shell")
    return text[:JD_MAX_CHARS]


# ── upload + analyze (stdlib multipart, ported verbatim) ─────────────
def _multipart(fields, files):
    boundary = uuid.uuid4().hex
    out = bytearray()
    for name, value in fields:
        out += (f"--{boundary}\r\nContent-Disposition: form-data; "
                f'name="{name}"\r\n\r\n{value}\r\n').encode()
    for name, filename, content, ctype in files:
        out += (f"--{boundary}\r\nContent-Disposition: form-data; "
                f'name="{name}"; filename="{filename}"\r\n'
                f"Content-Type: {ctype}\r\n\r\n").encode()
        out += content + b"\r\n"
    out += f"--{boundary}--\r\n".encode()
    return bytes(out), f"multipart/form-data; boundary={boundary}"


def _post_multipart(url: str, fields, files, timeout: int):
    body, ctype = _multipart(fields, files)
    req = urllib.request.Request(url, data=body,
                                 headers={**UA, "Content-Type": ctype})
    with urllib.request.urlopen(req, timeout=timeout, context=_SSL_CTX) as r:
        return json.load(r)


def jd_filename(job: JobFact) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-",
                  f"{job.company_name} {job.title}".lower()).strip("-")
    return slug[:120] + ".txt"


def upload_jd(agent_base: str, job: JobFact, text: str) -> str:
    r = _post_multipart(f"{agent_base}/upload", [],
                        [("file", jd_filename(job), text.encode(), "text/plain")], 60)
    if "path" not in r:
        raise HarvestError(f"upload rejected: {r}")
    return r["path"]


def analyze_batch(api_base: str, resume_path: Path,
                  server_paths: list[str]) -> list[dict]:
    ctype = mimetypes.guess_type(resume_path.name)[0] or "application/octet-stream"
    fields = [("jobs", p) for p in server_paths]
    files = [("resume", resume_path.name, resume_path.read_bytes(), ctype)]
    return _post_multipart(f"{api_base}/analyze", fields, files, 600)


def to_match(job: JobFact, rep: dict) -> MatchResult:
    a = rep.get("analysis") or {}
    sb = rep["score_breakdown"]
    return MatchResult(
        job=job,
        total_score=sb["total_score"],
        required_skills_score=sb.get("required_skills_score", 0),
        preferred_skills_score=sb.get("preferred_skills_score", 0),
        experience_score=sb.get("experience_score", 0),
        domain_score=sb.get("domain_score", 0),
        match_band=rep["match_status"],
        recommendation=rep.get("recommendation", ""),
        missing_skills=(a.get("gaps") or a.get("ats_keywords_missing") or [])[:5],
        cover_letter=(rep.get("cover_letter_text") or "").strip(),
    )


# ── the node ─────────────────────────────────────────────────────────
def run_match(candidates: list[JobFact], resume_path: Path, cfg: dict,
              environ=None, harvest=harvest_jd, upload=upload_jd,
              analyze=analyze_batch) -> tuple[list[MatchResult], list[Failure]]:
    """Guards first (abort BEFORE any paid call), then one attempt per job;
    a job's failure never stops its siblings."""
    environ = environ if environ is not None else os.environ
    m = cfg["matcher"]
    if not candidates:
        return [], []
    if len(candidates) > m["max_jobs_per_run"]:
        raise GuardError(
            f"{len(candidates)} candidates exceed max_jobs_per_run="
            f"{m['max_jobs_per_run']} — suspicious delta, aborting before "
            "any paid call")
    if environ.get("RUN_PAID_MATCH") != "1":
        raise GuardError("RUN_PAID_MATCH != 1 — refusing paid /analyze calls")
    api_base = environ["JOBMATCH_API_BASE"].rstrip("/")
    agent_base = environ["JOBMATCH_AGENT_BASE"].rstrip("/")

    failures: list[Failure] = []
    uploaded: list[tuple[JobFact, str]] = []
    for job in candidates:
        ref = f"{job.company_name} / {job.title}"
        try:
            text = harvest(job, cfg["slugs"])
            uploaded.append((job, upload(agent_base, job, text)))
        except Exception as e:                        # one attempt, no retry
            log.error("match: %s failed: %s", ref, e)
            failures.append(Failure(node="match", job_ref=ref, reason=str(e)))

    matches: list[MatchResult] = []
    size = m.get("batch_size", 5)
    for i in range(0, len(uploaded), size):
        chunk = uploaded[i:i + size]
        try:
            reps = analyze(api_base, resume_path, [p for _, p in chunk])
            matches += [to_match(job, rep) for (job, _), rep in zip(chunk, reps)]
        except Exception as e:                        # whole chunk fails once
            for job, _ in chunk:
                ref = f"{job.company_name} / {job.title}"
                log.error("analyze: %s failed: %s", ref, e)
                failures.append(Failure(node="match", job_ref=ref, reason=str(e)))
    log.info("match: %d analyzed, %d failures", len(matches), len(failures))
    return matches, failures
