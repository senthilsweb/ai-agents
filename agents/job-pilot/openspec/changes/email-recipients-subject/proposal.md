# Proposal: email-recipients-subject — multi-recipient To, templated subject

> Status: **APPROVED** (2026-07-16, owner-requested; template and
> CC-scope decided at the gate). Owner: @senthilsweb.

## Why

Two hard-coded aspects of the digest email need to be owner-tunable:
`DIGEST_TO` accepted exactly one address, and the subject line was
fixed (`daily digest — <date>`), which wastes the inbox list as a
triage surface.

## What changes

1. **Recipients**: `DIGEST_TO` accepts a comma-separated list
   (`a@x.com, b@y.com`). The pipeline splits, trims, and sets a
   multi-address `To:` header; smtplib delivers to all. Same secret,
   same workflow line — adding a recipient is editing one secret value.
   Decided at the gate: **To only**, no CC/BCC (add later if needed).
2. **Subject**: new `email.subject_template` in `config.yaml` (a
   tunable, not a secret) with placeholders `{date}` (dd-mmm-yyyy),
   `{new}`, `{candidates}`, `{matched}`, `{strong}`, `{pdfs}`.
   Default (gate decision):
   `[job-pilot] {matched} matches ({strong} strong) · {new} new · {date}`.
   Rendering is safe `str.format` — an unknown placeholder renders
   empty and logs a warning; a bad template must never block the send.
   Replaces the `subject_prefix` knob.

## Impact

Touched: `config.yaml`, `pipeline/digest.py` (subject rendering +
recipient parsing), `pipeline/graph.py` (send node builds the subject
context), tests, configuration docs, `.env.example` comment.
Unchanged: compose/cards, PDFs, workflows (secret names unchanged).
