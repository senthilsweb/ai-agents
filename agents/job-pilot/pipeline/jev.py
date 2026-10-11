"""Jev gate: TypeSafe's Jev decides the fuzzy rules (location, role fit,
resume variant); everything deterministic stays code.

Spec: agents/job-pilot/openspec/changes/jev-rules-gate/.

Modes (JEV_MODE): off | shadow | enforce, default off. No
TYPESAFE_API_KEY means off. In shadow Jev is called for the same jobs
enforce would call and every disagreement is recorded, but the run uses
the existing rules unchanged. In enforce a confident Jev answer decides
a question; a low-confidence answer, a Jev error or an open circuit
breaker hands that job back to the existing rule, so a Jev outage can
never block the digest.

Privacy: a request carries only the whitelisted JobFact fields in
STATE_FIELDS and the configured question text. No resume, cover letter
or candidate identity ever reaches this module. The API key is read
from the environment, sent only as the Authorization header, and never
logged.
"""
import json
import logging
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field

from pipeline.filters import (is_candidate, location_ok, passes_prefilter,
                              title_matches)
from pipeline.letters import slugify
from pipeline.resumes import KEYS, choose_variant
from pipeline.state import Failure, GateRecord, JobFact

log = logging.getLogger("job_pilot.jev")

MODES = ("off", "shadow", "enforce")
STATE_FIELDS = ("title", "department", "employment_type", "location",
                "work_mode", "comp_summary")
RETRY_STATUS = (429, 529)         # TypeSafe: rate limit / server busy
DEFAULTS = {
    "api_url": "https://api.typesafe.ai/v1/systemone",
    "model": "jev-latest",
    "timeout_s": 20,
    "max_retries": 2,
    "breaker_after": 5,           # consecutive errors before Jev is skipped
    "near_miss_floor": 0.30,      # rejected, yet Jev gave it >= this to pass
    "thresholds": {"location": 0.85, "target_role": 0.85, "variant": 0.7},
}


class JevError(RuntimeError):
    """One Jev call failed or returned something unusable."""


def resolve_mode(environ=None) -> str:
    environ = os.environ if environ is None else environ
    raw = (environ.get("JEV_MODE") or "off").strip().lower()
    if raw not in MODES:
        log.warning("jev: unknown JEV_MODE %r — using off", raw)
        return "off"
    if raw != "off" and not environ.get("TYPESAFE_API_KEY"):
        log.warning("jev: JEV_MODE=%s but TYPESAFE_API_KEY is empty — "
                    "using off", raw)
        return "off"
    return raw


def job_state(job: JobFact) -> dict:
    """The only data about a job that leaves the process."""
    return {f: getattr(job, f) for f in STATE_FIELDS if getattr(job, f)}


def build_questions(jcfg: dict, title_keywords: list[str]) -> dict:
    """Typed questions for one job. The target-role wording is built
    from job-scout's targets, so the targets stay single-sourced."""
    q = jcfg["questions"]
    return {
        "location": {"type": "choice", **q["location"]},
        "target_role": {
            "type": "noul",
            "instructions": q["target_role"]["instructions"].format(
                targets=", ".join(title_keywords))},
        "variant": {"type": "choice", **q["variant"]},
    }


@dataclass
class Verdict:
    location: str
    location_conf: float
    role_p: float            # noul: probability the title is a target role
    variant: str
    variant_conf: float


@dataclass
class Reply:
    verdict: Verdict
    model: str | None = None
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0


def parse_answers(answers: dict, questions: dict) -> Verdict:
    try:
        loc, role, var = (answers["location"], answers["target_role"],
                          answers["variant"])
        v = Verdict(location=loc["choice"],
                    location_conf=float(loc["confidence"]),
                    role_p=float(role["noul"]),
                    variant=var["choice"],
                    variant_conf=float(var["confidence"]))
    except (KeyError, TypeError, ValueError) as e:
        raise JevError(f"unparseable answers: {type(e).__name__}") from None
    if v.location not in questions["location"]["criteria"] or \
            v.variant not in questions["variant"]["criteria"] or \
            not 0 <= v.role_p <= 1:
        raise JevError("answer outside the question's options")
    return v


class JevClient:
    def __init__(self, api_key: str, jcfg: dict, sleep=time.sleep,
                 opener=urllib.request.urlopen):
        self._key = api_key
        self.url = jcfg["api_url"]
        self.model = jcfg["model"]
        self.timeout = jcfg["timeout_s"]
        self.max_retries = jcfg["max_retries"]
        self._sleep = sleep
        self._open = opener

    def ask(self, state: dict, questions: dict) -> Reply:
        body = json.dumps({"model": self.model, "state": state,
                           "questions": questions}).encode()
        for attempt in range(self.max_retries + 1):
            req = urllib.request.Request(self.url, data=body, headers={
                "Authorization": f"Bearer {self._key}",
                "Content-Type": "application/json",
                "User-Agent": "job-pilot/0.1 (+github.com/senthilsweb/ai-agents)"})
            try:
                with self._open(req, timeout=self.timeout) as r:
                    payload = json.load(r)
                    cost = r.headers.get("X-Cost-USD")
                usage = payload.get("usage") or {}
                return Reply(
                    verdict=parse_answers(payload.get("answers") or {},
                                          questions),
                    model=payload.get("model"),
                    input_tokens=int(usage.get("input_tokens", 0)),
                    output_tokens=int(usage.get("output_tokens", 0)),
                    cost_usd=float(cost) if cost else 0.0)
            except urllib.error.HTTPError as e:
                if e.code in RETRY_STATUS and attempt < self.max_retries:
                    wait = e.headers.get("retry-after") if e.headers else None
                    try:
                        delay = min(10.0, float(wait))
                    except (TypeError, ValueError):
                        delay = float(2 ** attempt)
                    self._sleep(delay)
                    continue
                raise JevError(f"HTTP {e.code}") from None
            except JevError:
                raise
            except (OSError, ValueError, KeyError, AttributeError) as e:
                raise JevError(f"{type(e).__name__}: {e}") from None
        raise JevError("retries exhausted")   # pragma: no cover


@dataclass
class Outcome:
    candidates: list[JobFact]
    records: list[GateRecord] = field(default_factory=list)
    variants: dict[str, str] = field(default_factory=dict)
    failures: list[Failure] = field(default_factory=list)
    stats: dict = field(default_factory=dict)


def _merge(jcfg: dict | None) -> dict:
    out = {**DEFAULTS, **(jcfg or {})}
    out["thresholds"] = {**DEFAULTS["thresholds"],
                         **((jcfg or {}).get("thresholds") or {})}
    return out


def gate(new: list[JobFact], flt: dict, cfg: dict, environ=None,
         client: JevClient | None = None, mode: str | None = None) -> Outcome:
    """Select match candidates from `new`. Returns the same candidates
    as the existing rules when off or shadow."""
    environ = os.environ if environ is None else environ
    mode = mode or resolve_mode(environ)
    rule_cands = [j for j in new if is_candidate(j, flt)]
    if mode == "off":
        return Outcome(rule_cands, stats={"mode": "off"})

    jcfg = _merge(cfg.get("jev"))
    thr = jcfg["thresholds"]
    questions = build_questions(jcfg, flt["title_keywords"])
    client = client or JevClient(environ["TYPESAFE_API_KEY"], jcfg)
    rcfg = cfg.get("resumes", {})
    rule_set = {id(j) for j in rule_cands}

    records: list[GateRecord] = []
    asked: list[tuple[JobFact, GateRecord]] = []
    errors: list[str] = []
    stats = {"mode": mode, "calls": 0, "errors": 0, "input_tokens": 0,
             "output_tokens": 0, "cost_usd": 0.0, "model": None,
             "asked": 0, "skipped_open_breaker": 0}
    consecutive = 0

    for job in (j for j in new if passes_prefilter(j, flt)):
        ref = f"{job.company_name} / {job.title}"
        slug = slugify(job.company_name, job.title)
        rule_cand = id(job) in rule_set
        rule_var = choose_variant(job.title, rcfg)
        rec = GateRecord(job_ref=ref, slug=slug, rule_candidate=rule_cand,
                         rule_variant=rule_var, candidate=rule_cand,
                         variant=rule_var)
        stats["asked"] += 1
        verdict = None
        if consecutive >= jcfg["breaker_after"]:
            stats["skipped_open_breaker"] += 1
            rec.error = "skipped: too many consecutive Jev errors"
        else:
            stats["calls"] += 1
            try:
                reply = client.ask(job_state(job), questions)
                verdict = reply.verdict
                consecutive = 0
                stats["input_tokens"] += reply.input_tokens
                stats["output_tokens"] += reply.output_tokens
                stats["cost_usd"] += reply.cost_usd
                stats["model"] = reply.model or stats["model"]
            except JevError as e:
                consecutive += 1
                stats["errors"] += 1
                errors.append(str(e))
                rec.error = str(e)
        records.append(rec)
        asked.append((job, rec))
        if verdict is None:
            continue

        rec.jev_location = verdict.location
        rec.jev_location_conf = verdict.location_conf
        rec.jev_role_p = verdict.role_p
        rec.jev_variant = verdict.variant
        rec.jev_variant_conf = verdict.variant_conf

        # location: reject only a confident non_us; "unclear" passes so a
        # city the string list never heard of still reaches the matcher
        loc_sure = verdict.location_conf >= thr["location"]
        if not flt.get("us_only", True):
            loc_pass, loc_src = True, "jev"
        elif loc_sure:
            loc_pass, loc_src = verdict.location != "non_us", "jev"
        else:
            loc_pass, loc_src = location_ok(job, flt), "rule"
        role_conf = max(verdict.role_p, 1 - verdict.role_p)
        role_sure = role_conf >= thr["target_role"]
        if role_sure:
            role_pass, role_src = verdict.role_p >= 0.5, "jev"
        else:
            role_pass, role_src = title_matches(job, flt), "rule"
        rec.jev_candidate = loc_pass and role_pass
        var_sure = (verdict.variant_conf >= thr["variant"]
                    and verdict.variant in KEYS)
        jev_var = verdict.variant if var_sure else rule_var

        if not rec.jev_candidate:
            # near-miss = rejected although Jev put real probability on
            # "pass". Confidence alone cannot say this: Jev answers sit
            # near 1.0, so "below threshold + margin" flags everything.
            if not loc_pass:
                rec.reason = (f"location: {verdict.location} "
                              f"({verdict.location_conf:.2f}, {loc_src})")
                pass_p = 1 - verdict.location_conf
            else:
                rec.reason = (f"role fit: p={verdict.role_p:.2f} ({role_src})")
                pass_p = verdict.role_p
            rec.near_miss = pass_p >= jcfg["near_miss_floor"]
        rec.disagree = (rec.jev_candidate != rule_cand
                        or (rule_cand and jev_var != rule_var))
        if mode == "enforce":
            rec.candidate = rec.jev_candidate
            rec.variant = jev_var

    if mode == "enforce":
        # a record exists only for prefiltered jobs; those whose call
        # failed already carry the rule's verdict in rec.candidate
        candidates = [j for j, r in asked if r.candidate]
        variants = {r.slug: r.variant for r in records
                    if r.candidate and r.variant != r.rule_variant}
    else:
        candidates, variants = rule_cands, {}

    failures = []
    if errors:
        failures.append(Failure(
            node="jev", job_ref="-",
            reason=(f"{stats['errors']} of {stats['calls']} Jev calls failed "
                    f"(first: {errors[0]}); the existing rules decided "
                    f"those jobs")))
    stats["rule_candidates"] = len(rule_cands)
    stats["jev_candidates"] = len(candidates) if mode == "enforce" else sum(
        1 for r in records if r.jev_candidate)
    log.info("jev: mode=%s asked=%d calls=%d errors=%d tokens=%d/%d "
             "cost=$%.5f model=%s rule_candidates=%d jev_candidates=%d "
             "disagreements=%d", mode, stats["asked"], stats["calls"],
             stats["errors"], stats["input_tokens"], stats["output_tokens"],
             stats["cost_usd"], stats["model"], stats["rule_candidates"],
             stats["jev_candidates"], sum(r.disagree for r in records))
    return Outcome(candidates, records, variants, failures, stats)
