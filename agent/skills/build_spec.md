---
description: Build a Diagram Spec JSON from a request and/or reference image, and know the phase-trace schema used across the harness.
---

# Build Diagram Spec

Load this when you need to convert a request (and/or a reference image) into the
structured Diagram Spec, or when you need to write a phase-trace JSON file.

## Building the spec

Read any `reference` image (path under `inputs/`) as the source of truth for
layout/content. Convert the request into the **Diagram Spec** below. Genericize
vendor/product names into descriptive role labels by default; store originals in
`notes`. Leave >=40px gutters between zones; lay out left->right by flow and
top->bottom by abstraction. Write the result to `<run_dir>/spec.json` via
`write_run_file`.

```jsonc
{
  "title": "string", "subtitle": "string",
  "theme": { "mode": "dark|light", "mood": "refined|technical|editorial|vibrant",
             "palette_hint": "...", "font_hint": "display + body + mono families" },
  "canvas": { "w": 1480, "h": 900 },
  "zones": [ { "id": "z_x", "label": "...", "sublabel": "...", "accent": "sky",
               "box": { "left": 0, "top": 0, "w": 0, "h": 0 },
               "nodes": [ { "id": "n_x", "label": "...", "icon": "lucide-name", "accent": "..." } ] } ],
  "edges": [ { "id": "e1", "from": "z_a", "to": "z_b", "label": "...",
               "style": "solid|dashed|dotted", "animated": true,
               "color_role": "flow|read|control|success|fail", "route": "h|v|elbow" } ],
  "annotations": [ { "id": "a1", "text": "...", "attach_to": "z_x", "color_role": "control" } ],
  "personas": [ { "label": "...", "sublabel": "...", "icon": "lucide-name", "accent": "..." } ],
  "legend": [ { "label": "...", "desc": "...", "color_role": "flow" } ],
  "use_case": ["bullet", "bullet"],
  "notes": { "original_product_names": {} }
}
```

If a prewritten `spec` path was given, skip building and use that file as-is.

## Phase-trace schema

Every phase (orchestrate, render-<variation>, report) writes a JSON file under
`<run_dir>/phases/`. Use this shape so the reporter can aggregate them:

```jsonc
{
  "phase": "orchestrate|render|report",
  "variation": "<variation, for render traces>",
  "model": "<the model that ran the phase>",
  "started_at": "<ISO UTC>", "ended_at": "<ISO UTC>", "duration_s": 0,
  "iterations": 1,                       // render/verify loop count, render only
  "tokens": { "input": null, "output": null, "total": null, "source": "runtime|usage-file|unavailable" },
  "output_html": "<for render traces>",
  "preview_png": "<for render traces>",
  "html_bytes": 0,                       // wc -c of the html (effort proxy), render only
  "icons_inlined": 0,                    // render only
  "qc": { "passed": true, "issues_fixed": ["..."], "notes": "" }  // render only
}
```

Token capture priority: (1) a value the orchestrator passed you; (2) a
`usage.json` in `run_dir`; (3) a usage/credits figure your runtime exposes at end
of turn (record verbatim, `"source": "runtime"`); else null + `"unavailable"`.
Timing is always recorded regardless.
