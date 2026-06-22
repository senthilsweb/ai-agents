---
description: Run the deterministic multi-repository pull-request digest workflow.
---

# PR digest procedure

## Request resolution

Use `resolve_report_request` to normalize repositories and the UTC time interval. Dates are inclusive calendar days; the tool converts the end date to an exclusive timestamp.

## Fan-out

Invoke `repository-scout` once per repository. Each invocation is independent and should receive the same normalized interval and state. Each scout persists its normalized JSON into `runs/<runId>/repositories/<owner>__<repository>.json`; do not pass PR arrays back through the model.

## Assembly

Call the deterministic `render_and_save_report` tool exactly once with `runId`, `from`, `to`, and the resolved repositories. It reads the persisted per-repository JSON, computes totals, and writes the Markdown digest. There is no LLM reporter — do not invoke `digest-reporter`.

## Persistence

Return the exact `markdown`, `sandboxPath`, and `hostPath` from `render_and_save_report`. Do not regenerate, summarize, or edit the report.
