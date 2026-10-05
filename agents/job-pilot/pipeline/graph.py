"""The LangGraph pipeline: linear with one conditional edge.

Design: openspec/changes/add-job-pilot/design.md §Architecture; stack
pinned by ADR 0003 (StateGraph, no LangChain chains). v1 uses no
checkpointer — it is reserved for v2 human-in-the-loop (`interrupt()`
before outreach sends), which is the reason the graph exists at all.

    fetch_new_jobs → filter_roles → has_candidates?
        ├─ yes → match → render_pdfs → attach_resumes → compose_email → send_email
        └─ no  ─────────────────────→ compose_email → send_email

Failure policy (design.md §Failure handling): fetch_new_jobs and
send_email raise — nothing sensible can happen after either fails.
match, render_pdfs and attach_resumes accumulate into state["failures"]
instead, so the digest still reports them.
"""
import logging
import os
from pathlib import Path

from langgraph.graph import END, START, StateGraph

from pipeline import digest, letters, matcher, resumes
from pipeline.delta import new_jobs
from pipeline.filters import select_candidates
from pipeline.state import Failure, PilotState
from pipeline.telemetry import span

ROOT = Path(__file__).resolve().parent.parent
log = logging.getLogger("job_pilot.graph")


def default_deps() -> dict:
    """Real node implementations; tests inject fakes with the same keys."""
    return {
        "new_jobs": new_jobs,
        "select_candidates": select_candidates,
        "run_match": matcher.run_match,
        "render_all": letters.render_all,
        "scoring_resume": resumes.scoring_resume,
        "render_resumes": resumes.render_attachments,
        "compose": digest.compose,
        "build_message": digest.build_message,
        "send": digest.send,
    }


def build_graph(cfg: dict, deps: dict | None = None, tracer=None,
                environ=None, out_dir: Path | None = None):
    deps = deps or default_deps()
    environ = environ if environ is not None else os.environ
    m = cfg["matcher"]
    url = cfg["parquet"]["url_template"]

    def fetch_new_jobs(state: PilotState):
        with span(tracer, "fetch_new_jobs", baseline=state["baseline_tag"]):
            jobs = deps["new_jobs"](url.format(ref="main"),
                                    url.format(ref=state["baseline_tag"]))
        return {"new_jobs": jobs, "failures": state.get("failures", [])}

    def filter_roles(state: PilotState):
        with span(tracer, "filter_roles", new=len(state["new_jobs"])):
            cand = deps["select_candidates"](state["new_jobs"], cfg["filter"])
        return {"candidates": cand}

    def match(state: PilotState):
        with span(tracer, "match", candidates=len(state["candidates"])):
            try:
                resume = deps["scoring_resume"](
                    out_dir or ROOT / "runs", cfg["resumes"])
                matches, fails = deps["run_match"](
                    state["candidates"], resume, cfg, environ=environ)
            except matcher.GuardError:
                raise   # RUN_PAID_MATCH off is an operator switch: go red,
                        # never swallowed. Cap overflow no longer raises
                        # this — see graceful-match-cap.
            except Exception as e:        # run-level match failure → digest
                log.error("match node failed: %s", e)
                matches, fails = [], [Failure(node="match", job_ref="-",
                                              reason=str(e))]
        return {"matches": matches,
                "failures": state.get("failures", []) + fails}

    def render_pdfs(state: PilotState):
        with span(tracer, "render_pdfs", matches=len(state["matches"])):
            try:
                paths = deps["render_all"](state["matches"],
                                           m["pdf_band_threshold"],
                                           out_dir or ROOT / "runs")
                return {"pdf_paths": [str(p) for p in paths]}
            except Exception as e:
                log.error("render_pdfs failed: %s", e)
                return {"pdf_paths": [],
                        "failures": state.get("failures", []) +
                        [Failure(node="render_pdfs", job_ref="-", reason=str(e))]}

    def attach_resumes(state: PilotState):
        with span(tracer, "attach_resumes", matches=len(state["matches"])):
            try:
                paths, variants, fails = deps["render_resumes"](
                    state["matches"], m["pdf_band_threshold"], cfg["resumes"],
                    out_dir or ROOT / "runs", environ=environ)
                return {"resume_paths": [str(p) for p in paths],
                        "resume_variants": variants,
                        "failures": state.get("failures", []) + fails}
            except Exception as e:
                log.error("attach_resumes failed: %s", e)
                return {"resume_paths": [], "resume_variants": {},
                        "failures": state.get("failures", []) +
                        [Failure(node="resumes", job_ref="-", reason=str(e))]}

    def compose_email(state: PilotState):
        with span(tracer, "compose_email"):
            html = deps["compose"](
                state["run_date"], state["baseline_tag"], state["new_jobs"],
                state.get("candidates", []), state.get("matches", []),
                state.get("failures", []), m["pdf_band_threshold"],
                variants=state.get("resume_variants", {}),
                resume_count=len(state.get("resume_paths", [])))
        return {"email_html": html}

    def send_email(state: PilotState):
        from datetime import date

        from pipeline.digest import render_subject
        with span(tracer, "send_email", pdfs=len(state.get("pdf_paths", []))):
            matches = state.get("matches", [])
            subject = render_subject(
                cfg["email"].get("subject_template",
                                 "[job-pilot] daily digest — {date}"),
                {"date": date.fromisoformat(state["run_date"])
                         .strftime("%d-%b-%Y"),
                 "new": len(state.get("new_jobs", [])),
                 "candidates": len(state.get("candidates", [])),
                 "matched": len(matches),
                 "strong": sum(1 for m in matches
                               if m.match_band == "strong_match"),
                 "pdfs": len(state.get("pdf_paths", [])),
                 "resumes": len(state.get("resume_paths", []))})
            msg = deps["build_message"](
                state["email_html"], subject,
                [Path(p) for p in state.get("pdf_paths", []) +
                 state.get("resume_paths", [])], environ=environ)
            return {"send_result": deps["send"](msg, environ=environ)}

    def has_candidates(state: PilotState) -> str:
        return "match" if state["candidates"] else "compose_email"

    g = StateGraph(PilotState)
    g.add_node("fetch_new_jobs", fetch_new_jobs)
    g.add_node("filter_roles", filter_roles)
    g.add_node("match", match)
    g.add_node("render_pdfs", render_pdfs)
    g.add_node("attach_resumes", attach_resumes)
    g.add_node("compose_email", compose_email)
    g.add_node("send_email", send_email)
    g.add_edge(START, "fetch_new_jobs")
    g.add_edge("fetch_new_jobs", "filter_roles")
    g.add_conditional_edges("filter_roles", has_candidates,
                            ["match", "compose_email"])
    g.add_edge("match", "render_pdfs")
    g.add_edge("render_pdfs", "attach_resumes")
    g.add_edge("attach_resumes", "compose_email")
    g.add_edge("compose_email", "send_email")
    g.add_edge("send_email", END)
    return g.compile()
