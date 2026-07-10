# Templates

Cover-letter (and any future) templates live here, staged into the sandbox
at `/workspace/inputs/templates/`. Loaded at runtime by `assemble_report`
(Bolt 2) — never compiled into agent source, so swapping a template is an
ops action, not a code change. A missing template degrades to plain text
fields rather than failing the run. See `openspec/changes/add-job-matcher/
design.md` and `specs/job-matcher-agent/spec.md` ("Templates staged under
inputs").
