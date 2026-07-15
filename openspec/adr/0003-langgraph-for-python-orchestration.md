# ADR 0003 — LangGraph (not LangChain) for Python orchestration agents

- Status: proposed (with `add-job-pilot`)
- Date: 2026-07-15
- Owner: @senthilsweb

## Context

`job-pilot` is the repo's first Python orchestration agent that is not an
eve agent: a deterministic pipeline (parquet delta → matcher API → PDFs →
email) with **no LLM reasoning of its own**. v1 could be a plain script.
But the agreed roadmap adds steps that must pause for a human decision:
approving an outreach message before it is sent (v1.5/v2), confirming a
suggested referral contact (v2). The orchestration runtime is chosen for
that future, and the choice should be consistent for any later Python
pipeline agent in this repo.

## Decision

1. **LangGraph `StateGraph` is the required runtime** for Python
   orchestration agents: explicit typed state, nodes as functions,
   conditional edges, and — the part v1 does not use but v2 needs —
   a checkpointer plus `interrupt()` for human-in-the-loop pauses that
   survive process restarts.
2. **LangChain's chain/agent abstractions are not used.** No
   `langchain` meta-package, no `AgentExecutor`, no chain classes.
   `langchain-core` is tolerated only as a transitive dependency of
   langgraph and is never imported directly. Model calls, when an agent
   has them, use the provider SDK or plain HTTPS.
3. Graphs stay boring: linear plus explicitly justified branches. If a
   pipeline needs no pause and no branch, the graph is still used — the
   consistency (tracing, checkpointing, one mental model) is the point.

## Consequences

- Human-in-the-loop features arrive as a new node + checkpointer config,
  not a rewrite. This is the concrete reason the abstraction is paid for
  in v1.
- LangSmith tracing comes free with the runtime (env vars only), joining
  the repo's existing OTel dual export (OpenObserve + Arize Phoenix)
  rather than replacing it.
- Deterministic pipelines with no in-agent LLM keep code-level pytest
  suites as their eval story; the graph adds one wiring test, not an
  LLM-judge harness.
- Anyone reading a Python agent here finds the same shape: `state.py`,
  `graph.py`, nodes as pure-ish functions, `run.py` entrypoint.
