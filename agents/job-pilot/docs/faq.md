# FAQ

Short answers; each links to the spec or ADR that recorded the full
reasoning. Specs live under
[`openspec/changes/add-job-pilot/`](https://github.com/senthilsweb/ai-agents/tree/main/openspec/changes/add-job-pilot).

**Why is there no database?**
The public trends parquet plus its daily git tags already *is* one:
`main` is the latest snapshot, every day has an immutable tag, and an
in-memory DuckDB anti-join between two URLs yields "new since last
run". No state to back up, host, or leak.
(Spec: `specs/new-jobs-delta/spec.md`.)

**Why LangGraph for a pipeline this simple?**
Version 2 adds human-in-the-loop approval before outreach messages are
sent. LangGraph's checkpointer and `interrupt()` make that an added
node, not a rewrite. LangChain's chain abstractions are deliberately
not used.
([ADR 0003](https://github.com/senthilsweb/ai-agents/blob/main/openspec/adr/0003-langgraph-for-python-orchestration.md).)

**Why are the evals plain pytest instead of LLM-judged?**
job-pilot contains no LLM reasoning — all model calls happen inside the
deployed job-matcher API. Deterministic code gets deterministic tests.
(Design: `design.md` §Evals.)

**Why does a job show "not analyzed" in the digest?**
It passed the category filter but failed a rule that does not pay for
analysis: no title-keyword hit, or a salary band below the floor. It is
listed so you can overrule the filter by hand.

**Why did I get an email saying "no new matching jobs"?**
By design. A quiet day still sends a short email so that silence always
means breakage. (Spec: `specs/email-digest/spec.md`.)

**Why is the resume committed to a public repository?**
Owner decision at the Inception gate (2026-07-15): simpler CI, no fetch
token, and what is committed is exactly what is scored. The committed
copy is scrubbed — no phone, no street address.

**Why fpdf2 and not WeasyPrint or python-docx for the PDFs?**
WeasyPrint needs system pango/gobject libraries; DOCX→PDF conversion
needs LibreOffice or Word. Both are heavyweight dependencies for a
one-page letter. fpdf2 is pure Python, and the letterhead is a data
template (`templates/letterhead.yaml`).
(Corrections logged in `add-job-pilot/tasks.md` and
`templated-cover-letter/proposal.md`.)

**Why doesn't a failed job get retried?**
One attempt, log, report, continue — the same policy job-matcher pinned.
Retries hide real board problems and can double cost. The job appears
in the digest's Failures section instead.
(Spec: `specs/match-runner/spec.md`.)

Next: [Home](index.md)
