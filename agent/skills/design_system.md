---
description: Visual and technical contract for building a stunning, self-contained HTML architecture diagram. Load before rendering any diagram, and follow it exactly.
---

# Design System — Stunning Architecture Diagrams

Shared visual + technical contract for the Renderer. Goal: presentation-grade,
self-contained diagrams that never look like generic templates.

## Theme & typography
- Commit to ONE bold direction. Default: **clean light** — paper base, subtle
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
1. The page is a **bounded card**, NOT full-viewport. The `<body>` is a flex
   centering container with `min-height:100vh` removed (so the page is a bounded
   box, never full-screen and never forces a page break): a `.frame` wrapper with
   `max-width` matching the canvas width (+ ~40px padding), `margin: auto`, and
   `padding`. The `.canvas` lives inside `.frame`. This is the default `fit=card`.
   ```css
   html,body{ margin:0 }
   body{ display:flex; justify-content:center; align-items:flex-start;
         padding:32px; background:var(--bg0); min-height:auto } /* NO min-height:100vh */
   .frame{ width:100%; max-width:calc(<W>px + 40px); margin:0 auto }
   .canvas{ position:relative; width:<W>px; height:<H>px; margin:0 auto }
   ```
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

## Canvas size & fit (controls page-break / full-page behavior)

The canvas dimensions come from the `size` preset or an explicit `canvas=WxH`.
The **`fit`** option controls how the canvas sits on the page — this is what
prevents the "always full-page / breaks across pages" problem.

### Size presets (canvas dimensions)
| `size` | Canvas (≈) | Use for |
|---|---|---|
| `compact` | `1040 × 660` | a small, embeddable diagram |
| `standard` | `1280 × 800` | a balanced default |
| `wide` | `1480 × 1000` | dense, many-zone diagrams |

An explicit `canvas=WxH` (e.g. `canvas=1040x660`) overrides the preset.

### Fit modes (`fit` option, default `card`)
| `fit` | Page shell | When to use |
|---|---|---|
| `card` | **Bounded card** (default). Body is a flex centering container with `min-height:auto` (no `100vh`), `.frame` wraps the canvas with `max-width` ≈ canvas+padding, centered. The page is a bounded box — no forced full-page, no page breaks. | diagrams for slides, docs, embeds — the common case |
| `scale` | **Scale-to-fit.** Keeps the wide layout but wraps the canvas so it scales down to a `max-width` via `transform: scale()`, `transform-origin: top-left`, and the frame height is adjusted by the scale factor. Body is bounded (no `100vh`). | embed a wide diagram in a narrower column without relayout |
| `full` | **Full-page** (legacy). Canvas fills the viewport (`min-height:100vh`, no max-width). Only use when you specifically want full-screen. | full-screen dashboards |

**Default behavior is `fit=card` with `size=standard`** — a 1280×800 canvas in a
centered, bounded card. The renderer MUST NOT use `min-height:100vh` or
`height:100vh` on the body unless `fit=full`. This is what stops diagrams from
stretching full-page and breaking across printed/exported pages.

For `fit=scale`, compute `scale = min(1, maxWidth / canvasWidth)` and apply it:
```css
.scaler{ transform:scale(var(--s)); transform-origin:top left;
         width:calc(<W>px * var(--s)); height:calc(<H>px * var(--s)) }
.canvas{ width:<W>px; height:<H>px }
```

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
