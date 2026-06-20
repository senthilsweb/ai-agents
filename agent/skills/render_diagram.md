---
description: Renderer procedure. Given a Diagram Spec + run folder + variation, produce ONE stunning self-contained HTML diagram, self-verify with a headless screenshot, write artifacts, and emit a phase trace. Run this when delegated a single variation to render.
---

# Render Diagram

You are delegated ONE variation to render. You receive: a **Diagram Spec** (or a
path to `spec.json`), a **run_dir**, a **variation** id, an **out_name**, and
optionally a **reference image**. You produce ONE beautiful, dependency-free
HTML diagram. Loop: **build -> self-verify (headless screenshot) -> fix -> emit trace.**

## Steps

### 1 — Start the phase clock
Note the start time (ISO UTC). You will compute `duration_s` for your trace.

### 2 — Build the diagram
Load the `design_system` skill and follow it exactly. Non-negotiables:
- Fixed-size **canvas** with absolutely-positioned **zones**; one overlay **SVG
  "wire" layer** for ALL connectors, drawn to exact zone-edge coordinates.
- **Inline Lucide icons** (no runtime icon CDN). Use the `fetch_lucide_icon` tool
  to get each icon's inner shapes; it resolves renamed icons. **No emojis.**
- Commit to ONE bold theme (default dark): glassmorphism, one accent per zone,
  radial glows, faint grid texture, distinctive type pairing, tasteful motion
  (marching-ants connectors + a couple of SMIL glow dots, staggered load-in).
- Apply the spec's `theme.mode`; for a `light` variation, invert the palette but
  keep the same structure.
- Genericize labels per `spec.notes` unless told otherwise.
- Use the `size` preset or explicit `canvas` from the options to set canvas
  dimensions: compact ~1040x660, standard ~1280x800, wide ~1480x1000.

Write the file to `<run_dir>/<out_name>[-<variation>].html` via `write_run_file`.
For the `default` variation, omit the `-<variation>` suffix.

### 3 — Self-verify (mandatory)
Render headless and inspect the screenshot before returning. Call the
`render_screenshot` tool with the html path; it returns the preview png path.
Inspect for: empty icon chips (icon name wrong -> fix + re-inline), text
overflow/clipping, connectors landing in the wrong place or pointing the wrong
way, overlapping zones, weak contrast, and fidelity to the reference image. Fix
and re-render. Cap at ~4 iterations; track the count.

### 4 — Emit the phase trace
Write `<run_dir>/phases/render-<variation>.json` via `write_run_file` using the
phase-trace schema from the `build_spec` skill. Always fill `html_bytes`
(byte length of the html — an effort proxy) and `icons_inlined`, and the `qc`
block with `passed` + any `issues_fixed`.

### 5 — Return
Return a short result to the orchestrator: `{ html, preview, trace, qc.passed }`.
Do not add prose for the end user.
