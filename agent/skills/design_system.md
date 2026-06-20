---
description: Visual and technical contract for building a stunning, self-contained HTML architecture diagram. Load before rendering any diagram, and follow it exactly.
---

# Design System — Stunning Architecture Diagrams

Shared visual + technical contract for the Renderer. Goal: presentation-grade,
self-contained diagrams that never look like generic templates.

## Theme & typography
- Commit to ONE bold direction. Default: **refined dark** — deep gradient base,
  faint masked grid texture, radial accent glows. For a `light` variation, invert
  to a clean paper base while keeping structure and accents.
- VARY the font pairing per diagram so outputs do not all look the same. Avoid
  Inter / Roboto / Arial / system defaults and the cliche purple-on-white gradient.
  Solid pairings (rotate): Sora / IBM Plex Sans / JetBrains Mono (technical,
  default) · Space Grotesk / Newsreader / IBM Plex Mono (editorial) · Archivo /
  Sora / Geist Mono (product) · Fraunces / Public Sans / Spline Sans Mono (luxe).
- CSS variable palette: dark base (`--bg0/--bg1/--bg2`), translucent panel/stroke
  vars, text tiers (`--txt/--dim/--faint`), and 4-6 accent roles mapped from the
  spec's `color_role`s. Use `color-mix()` to derive tints/borders so chips glow
  consistently.

## Layout method (follow exactly — this is what keeps arrows aligned)
1. `.canvas { position:relative; width:<W>px; height:<H>px }` inside a
   horizontally-scrollable wrapper.
2. Zones are **absolutely positioned** at the spec's `box` coords, `z-index:2`.
   Nested zones (zone > subzone > group > chip) use increasing z-index.
3. ONE **SVG wire layer** over the canvas: `position:absolute; inset:0;
   viewBox="0 0 W H"; z-index:1; pointer-events:none`. ALL connectors live here,
   drawn to exact zone-edge coordinates computed from the boxes.
4. Zone interiors use flex/grid; only the outer box matters for connector math.
5. Arrowheads via `<marker>` (one per color role). Lines animate with
   `stroke-dashoffset` keyframes (marching ants). Add 2-3 SMIL `<animateMotion>`
   glow dots on primary flows. End arrows at the target box EDGE, not its center.
6. Routing: horizontal flow = straight `H` at a shared y; control/read links =
   `V` or elbow `M x,y V y2 H x2`. Keep >=40px gutters; avoid spaghetti crossings.
7. Cards: glass (translucent fill, hairline border, blur, soft shadow + inner top
   highlight, ~14px radius). Each zone gets a faint radial accent glow via `::before`.
8. Icon chips: rounded square, accent-tinted bg + border + soft glow, the inlined
   SVG centered; size icons in `em` so the chip's font-size controls them.
9. Reveal: staggered load-in via `animation-delay` following data-flow order.
10. Texture: faint CSS grid background masked with a radial fade for depth.

## Inlining Lucide icons (no runtime CDN)
Use the `fetch_lucide_icon` tool to get a single icon's inner SVG shapes (it
resolves renamed icons such as `pie-chart`->`chart-pie`, `line-chart`->`chart-line`,
`bar-chart-3`->`chart-column`, `arrow-up-circle`->`circle-arrow-up`,
`waves`->`droplets`). Inline what it returns:

```html
<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round">...inner...</svg>
```

Global: `.ic{ width:1em; height:1em; display:block; flex:none }`; set color on the
chip (stroke inherits `currentColor`). No emojis, ever. A token approach works
well: author with `[[icon:name]]` placeholders, then one pass replaces them.

## Anti-slop quality bar
- Intentional composition: alignment, rhythm, controlled spacing.
- One accent per zone; dominant base color with sharp accent hits.
- Distinctive type; never the banned generic fonts.
- Motion only where it adds meaning (flow direction, hierarchy on load).
- Reference image (if any): match zones, order, and relationships FIRST; you may
  elevate the visual style. Reproduce labels but genericized per `spec.notes`.
- If it could pass for a default Bootstrap/Tailwind demo, redesign it.

## Output contract
- One standalone `.html`, no build step, opens in any browser.
- Inlined icons, no emojis, genericized labels by default, everything editable text.
- Fonts may load from Google Fonts but set fallbacks so a font failure does not
  break layout.
