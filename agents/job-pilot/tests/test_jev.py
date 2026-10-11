"""jev-rules-gate: modes, thresholds, fallback, privacy whitelist."""
import io
import json
import logging
import urllib.error

import pytest

from pipeline import jev
from pipeline.config import load_config
from pipeline.digest import compose
from pipeline.filters import is_candidate
from pipeline.graph import build_graph
from pipeline.state import JobFact

FLT = {"categories": ["Engineering & Tech", "Product", "Sales & GTM"],
       "title_keywords": ["engineering manager", "forward deployed"],
       "base_salary_min_usd": 200000, "us_only": True}
CFG = {"jev": {"questions": {
    "location": {"instructions": "where?", "criteria": {
        "us": "u", "remote_us": "r", "non_us": "n", "unclear": "?"}},
    "target_role": {"instructions": "target: {targets}"},
    "variant": {"instructions": "which?", "criteria": {
        "master": "m", "genai-fde": "g", "data-genai-fde": "d",
        "eng-manager": "e"}}}},
    "resumes": {"fallback": "master", "rules": [
        {"variant": "eng-manager", "title_contains": ["engineering manager"]}]}}


def job(title="Engineering Manager", loc="Remote US", **kw):
    return JobFact(company_name="Acme", ats_platform="ashby",
                   req_id=title + str(loc), title=title, location=loc,
                   category="Engineering & Tech", base_max_usd=250000, **kw)


def verdict(loc="us", lc=0.95, role=0.95, var="master", vc=0.9):
    return jev.Verdict(loc, lc, role, var, vc)


class FakeClient:
    """Returns a scripted verdict (or raises) per call, records requests."""
    def __init__(self, *script):
        self.script, self.states = list(script), []

    def ask(self, state, questions):
        self.states.append(state)
        item = self.script.pop(0) if len(self.script) > 1 else self.script[0]
        if isinstance(item, Exception):
            raise item
        return jev.Reply(item, model="jev-1.13.0", input_tokens=100,
                         output_tokens=5, cost_usd=0.000004)


def run(jobs, client, mode="enforce"):
    return jev.gate(jobs, FLT, CFG, environ={"TYPESAFE_API_KEY": "k"},
                    client=client, mode=mode)


# ── mode resolution ─────────────────────────────────────────────────
def test_unset_mode_is_off():
    assert jev.resolve_mode({}) == "off"


def test_no_key_forces_off_and_warns(caplog):
    with caplog.at_level(logging.WARNING, logger="job_pilot.jev"):
        assert jev.resolve_mode({"JEV_MODE": "enforce"}) == "off"
    assert "TYPESAFE_API_KEY" in caplog.text


def test_unknown_mode_is_off():
    assert jev.resolve_mode({"JEV_MODE": "yolo", "TYPESAFE_API_KEY": "k"}) == "off"


def test_off_is_the_existing_rules_with_no_calls():
    jobs = [job(), job("Account Executive"), job(loc="Berlin, Germany")]
    c = FakeClient(verdict())
    out = jev.gate(jobs, FLT, CFG, environ={}, client=c, mode="off")
    assert out.candidates == [j for j in jobs if is_candidate(j, FLT)]
    assert c.states == [] and out.records == []


# ── shadow ──────────────────────────────────────────────────────────
def test_shadow_changes_nothing_but_records_disagreement():
    # rules drop an unlisted city, Jev says it is in the US
    odd = job(loc="Boise Metro Area")
    ok = job()
    out = run([ok, odd], FakeClient(verdict()), mode="shadow")
    assert out.candidates == [j for j in (ok, odd) if is_candidate(j, FLT)]
    assert odd not in out.candidates and out.variants == {}
    assert any(r.disagree and r.jev_candidate and not r.rule_candidate
               for r in out.records)


# ── enforce ─────────────────────────────────────────────────────────
def test_enforce_jev_rescues_unlisted_city():
    odd = job(loc="Boise Metro Area")
    assert not is_candidate(odd, FLT)
    out = run([odd], FakeClient(verdict("us", 0.97, 0.95)))
    assert out.candidates == [odd]


def test_enforce_confident_non_us_rejects_with_reason():
    j = job(loc="Remote - Canada Only")
    out = run([j], FakeClient(verdict("non_us", 0.99)))
    assert out.candidates == []
    assert out.records[0].reason.startswith("location: non_us")


def test_enforce_confident_not_a_target_role_rejects():
    out = run([job()], FakeClient(verdict(role=0.04)))
    assert out.candidates == []
    assert out.records[0].reason.startswith("role fit")


def test_enforce_low_confidence_falls_back_to_rule():
    # rule keeps this job; Jev is unsure (0.6 < 0.85) so the rule wins
    kept = job()
    dropped = job("Account Executive")   # prefilter ok, title rule fails
    out = run([kept, dropped],
              FakeClient(verdict("non_us", 0.6, 0.5)))
    assert out.candidates == [kept]


def test_unclear_location_passes():
    out = run([job(loc="Somewhere")], FakeClient(verdict("unclear", 0.95)))
    assert len(out.candidates) == 1


def test_prefilter_runs_before_jev():
    cheap = job()
    cheap.base_max_usd = 90000                    # below the floor
    wrong_cat = job()
    wrong_cat.category = "Legal"
    c = FakeClient(verdict())
    out = run([cheap, wrong_cat], c)
    assert c.states == [] and out.candidates == []


def test_variant_override_only_when_confident():
    j = job("Engineering Manager")                # rule: eng-manager
    out = run([j], FakeClient(verdict(var="genai-fde", vc=0.95)))
    assert out.variants == {out.records[0].slug: "genai-fde"}
    out = run([j], FakeClient(verdict(var="genai-fde", vc=0.4)))
    assert out.variants == {} and out.records[0].variant == "eng-manager"


def test_near_miss_means_jev_gave_it_real_chance_to_pass():
    out = run([job("Account Executive")], FakeClient(verdict(role=0.40)))  # unsure -> rule drops
    assert out.records[0].near_miss is True       # p=0.40 >= floor 0.30
    out = run([job("Account Executive")], FakeClient(verdict(role=0.02)))
    assert out.records[0].near_miss is False


# ── failure handling ────────────────────────────────────────────────
def test_error_falls_back_records_failure_and_still_returns():
    a, b = job(), job("Account Executive")
    out = run([a, b], FakeClient(jev.JevError("HTTP 500")))
    assert out.candidates == [a]                  # exactly the rules' result
    assert out.failures and out.failures[0].node == "jev"
    assert out.stats["errors"] == 2


def test_circuit_breaker_stops_calls():
    jobs = [job(loc=f"City {i}") for i in range(12)]
    c = FakeClient(jev.JevError("HTTP 500"))
    out = run(jobs, c)
    assert len(c.states) == 5                     # breaker_after default
    assert out.stats["skipped_open_breaker"] == 7


# ── client: retries, parsing, auth ──────────────────────────────────
def _resp(payload, cost="0.000004"):
    class R(io.BytesIO):
        headers = {"X-Cost-USD": cost}
        def __enter__(self): return self
        def __exit__(self, *a): return False
    return R(json.dumps(payload).encode())


GOOD = {"model": "jev-1.13.0", "usage": {"input_tokens": 9, "output_tokens": 2},
        "answers": {
            "location": {"type": "choice", "choice": "us", "confidence": 0.9},
            "target_role": {"type": "noul", "noul": 0.9},
            "variant": {"type": "choice", "choice": "master", "confidence": 0.8}}}
Q = jev.build_questions(CFG["jev"], ["engineering manager"])
CL = {**jev.DEFAULTS, "questions": CFG["jev"]["questions"]}


def http(code, retry_after=None):
    class H(dict):
        def get(self, k, d=None): return retry_after if k == "retry-after" else d
    return urllib.error.HTTPError("u", code, "x", H(), None)


def test_client_retries_429_then_succeeds_and_sends_bearer():
    seen, sleeps = [], []
    seq = [http(429, "1"), http(529), _resp(GOOD)]

    def opener(req, timeout):
        seen.append(req)
        item = seq.pop(0)
        if isinstance(item, Exception):
            raise item
        return item
    c = jev.JevClient("secret-key", CL, sleep=sleeps.append, opener=opener)
    r = c.ask({"title": "x"}, Q)
    assert r.verdict.location == "us" and sleeps == [1.0, 2.0]
    assert seen[0].get_header("Authorization") == "Bearer secret-key"


def test_client_gives_up_after_retries_and_on_other_errors():
    def always(req, timeout): raise http(429)
    c = jev.JevClient("k", CL, sleep=lambda s: None, opener=always)
    with pytest.raises(jev.JevError):
        c.ask({}, Q)

    def server(req, timeout): raise http(500)
    c = jev.JevClient("k", CL, sleep=lambda s: None, opener=server)
    with pytest.raises(jev.JevError, match="HTTP 500"):
        c.ask({}, Q)


def test_unparseable_and_out_of_options_are_errors():
    bad = json.loads(json.dumps(GOOD))
    bad["answers"]["location"]["choice"] = "mars"
    with pytest.raises(jev.JevError):
        jev.parse_answers(bad["answers"], Q)
    with pytest.raises(jev.JevError):
        jev.parse_answers({}, Q)


# ── privacy ─────────────────────────────────────────────────────────
def test_request_state_is_whitelisted_job_facts_only():
    j = job(department="Eng", work_mode="remote", comp_summary="$200k")
    s = jev.job_state(j)
    assert set(s) <= set(jev.STATE_FIELDS)
    for leaked in ("req_id", "apply_url", "company_name", "base_max_usd"):
        assert leaked not in s
    c = FakeClient(verdict())
    run([j], c)
    assert c.states == [s]


def test_key_never_logged(caplog):
    secret = "sk-test-SECRET-123"

    def opener(req, timeout):
        raise http(500)
    client = jev.JevClient(secret, CL, sleep=lambda s: None, opener=opener)
    with caplog.at_level(logging.DEBUG):
        jev.gate([job()], FLT, CFG, environ={"TYPESAFE_API_KEY": secret},
                 client=client, mode="enforce")
        jev.resolve_mode({"JEV_MODE": "enforce", "TYPESAFE_API_KEY": secret})
    assert secret not in caplog.text


# ── real config + graph + digest ────────────────────────────────────
def test_real_config_builds_valid_questions():
    cfg = load_config()
    q = jev.build_questions(cfg["jev"], cfg["filter"]["title_keywords"])
    assert set(q) == {"location", "target_role", "variant"}
    assert set(q["variant"]["criteria"]) == set(jev.KEYS)
    assert cfg["filter"]["title_keywords"][0].lower() in \
        q["target_role"]["instructions"].lower()


def test_graph_gate_error_falls_back_to_rules_and_flags_digest():
    from test_graph import CFG as GCFG, deps_with
    calls = []
    deps = deps_with(calls)

    def boom(*a, **kw):
        raise RuntimeError("down")
    deps["jev_gate"] = boom
    cfg = {**GCFG, "jev": CFG["jev"]}
    g = build_graph(cfg, deps=deps,
                    environ={"JEV_MODE": "enforce", "TYPESAFE_API_KEY": "k"})
    final = g.invoke({"run_date": "2026-10-11",
                      "baseline_tag": "trends/20261010", "failures": []})
    assert "filter" in calls and final["send_result"] == "sent"
    assert any(f.node == "jev" for f in final["failures"])


def test_digest_gate_section_only_when_on():
    j = job()
    base = compose("2026-10-11", "trends/1", [j], [j], [], [], "good_match")
    assert "Gate &middot; Jev" not in base
    out = run([j, job(loc="Remote - Canada Only")],
              FakeClient(verdict(), verdict("non_us", 0.99)), mode="shadow")
    html = compose("2026-10-11", "trends/1", [j], [j], [], [], "good_match",
                   gate=out.records, gate_stats=out.stats)
    assert "Gate &middot; Jev shadow" in html and "nothing changed" in html
