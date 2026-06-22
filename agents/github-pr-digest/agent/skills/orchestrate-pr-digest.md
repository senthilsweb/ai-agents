---
description: Run the deterministic multi-repository pull-request digest workflow.
---

# PR digest procedure

## Request resolution

Use `resolve_report_request` to normalize repositories and the UTC time interval. Dates are inclusive calendar days; the tool converts the end date to an exclusive timestamp.

## Fan-out

Invoke `repository-scout` once per repository. Each invocation is independent and should receive the same normalized interval and state.

## Fan-in

Send every returned repository result, including errors, to `digest-reporter`. The reporter is responsible only for formatting and high-level observations grounded in supplied JSON.

## Persistence

Save the reporter's exact Markdown with `write_report`. Do not regenerate or edit the report after the reporter returns it.
