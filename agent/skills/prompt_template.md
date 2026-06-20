---
description: Internal scaffold prompt for generating a single diagram. Reference when you need the canonical TASK/CONTENT/RULES/VERIFY structure for one diagram.
---

# Prompt Template — Generate a Stunning Architecture Diagram

Fill the `{{PLACEHOLDERS}}`. The Orchestrator uses this when delegating to a
renderer copy; you can also use it to frame a single diagram.

---

## TASK
Create a single, self-contained **{{dark | light}}** architecture diagram as ONE
standalone HTML file. Subject: **{{TITLE}}** — {{ONE-LINE DESCRIPTION}}.
Audience / use: {{slide | docs | README | pitch}}.
{{IF RECREATING A REFERENCE: "Reproduce the attached image's zones, order, and
relationships faithfully; you may elevate the visual style."}}

## CONTENT (zones, nodes, edges)
Fixed canvas ~**{{W}}x{{H}}**. Place zones left->right by flow, top->bottom by
abstraction; keep >=40px gutters.
- **Zone {{Z1}}** — accent {{color}} — nodes: {{node, node}}
- **Zone {{Z2}}** — accent {{color}} — nodes: {{...}}
- Right rail (optional): personas {{Data Engineer, ...}}
Connect: {{Z1}} -> {{Z2}} ({{label}}, animated); {{Z2}} <-> {{control}} (dashed
"read access"); annotations: {{e.g. validation / status callouts}}.
Genericize vendor/product names into role labels unless told otherwise:
{{KEEP BRANDS? yes/no}}.

## HARD RULES
1. One standalone file, no build step, opens in any browser.
2. **Inline all icons as Lucide SVGs** (no runtime icon CDN); resolve renamed
   icons; **no emojis**.
3. Fonts via Google Fonts with safe fallbacks.
4. Everything editable plain text.

## DESIGN & LAYOUT
Follow the `design_system` skill: dark glassmorphism (or light variant), one
accent per zone, radial glows, grid texture, distinctive type, tasteful motion.
Use the fixed-canvas + single SVG wire-layer method; end arrows at box edges.

## VERIFY BEFORE RETURNING
Render headless at 2x, screenshot full-page, and check for empty icon chips, text
overflow, misrouted/backwards arrows, overlaps, weak contrast, and reference
fidelity. Fix and re-render until clean.

## DELIVERABLE
`{{out_name}}.html` written into the run folder, plus a `.preview.png`. Offer a
light/dark counterpart, brand-name restore, and SVG/PNG export.
