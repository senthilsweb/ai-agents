# Example Prompts

Copy-paste prompts for the Diagram Generator, now built on the **Vercel Eve**
framework. Start the agent with `npm run dev` (or `eve dev`) and send these in
the Eve TUI / HTTP channel.

The agent is the **Orchestrator** — it owns intake, run bookkeeping, and the
final summary. It delegates each variation to a renderer copy of itself and
delegates metrics to a reporter copy. You only change the parameters between
runs.

---

## 1. Port a reference image (keep product names)
Best for tech-stack / tooling diagrams where the products are the point.

```
Generate a diagram. reference=inputs/ai-analytics.png, variations=dark,light,
genericize=false, title="Data Analytics Platform". Run the full procedure: create
the run folder, write spec.json from the image, render each variation per the
design system with a headless self-verify screenshot, then write report.md +
summary.json. Print the output paths when done.
```

## 2. Port a reference image (vendor-neutral)
Same image, but strip brand names into descriptive role labels — good for sharing
externally.

```
Generate a diagram. reference=inputs/proxy-deployment.png, theme=dark,
genericize=true, title="Outbound Connectivity via Corporate Proxy". Do every step
and print the output file paths.
```

## 3. From a description (no reference image)
No input file — describe the architecture in words and let it build the spec.

```
Generate a diagram (no reference image). Build a dark diagram titled
"Event-Driven Order Pipeline" with three zones left-to-right: (1) "Edge" — API
Gateway, Auth; (2) "Core" — Order Service, Payment Service, a Kafka event bus;
(3) "Data" — Postgres, a read-model cache, an analytics warehouse. Animated flow
Edge -> Core -> Data; dashed "events" links from each Core service into Kafka.
genericize=false. Write everything into a runs/<UTC-timestamp>/ folder and print
the paths.
```

## 4. Both themes at once
Produce dark and light variants in a single run.

```
Generate a diagram. reference=inputs/ai-analytics.png, variations=dark,light,
genericize=false. Render both variations into the same runs/<UTC-timestamp>/
folder, self-verify each, then write one report.md covering both. Print the paths.
```

## 5. With token cost in the report
Turn on cost computation (uses the cost-rates skill — update the rates first).

```
Generate a diagram. reference=inputs/ai-analytics.png, theme=dark,
genericize=false, allow_cost=true. In the report, include the timing, token, and
cost tables. Print the paths.
```

## 6. Refine the last run (don't start over)
After you've seen a result, just describe the fix in plain language.

```
Open the diagram from the latest runs/ folder and regenerate it with these
changes: keep the Snowflake layer order (Raw -> Staging -> Intermediate -> Mart),
add the "Semantic Layer" box under Mart, and move "AI Agents & Chat Bots" up next
to "Embedded Analytics". Re-run the self-verify screenshot and update report.md
in a new runs/<UTC-timestamp>/ folder.
```

## 7. Compact size (smaller, re-laid out)
Fit the same content into a smaller canvas so it isn't full-page.

```
Generate a diagram. reference=inputs/ai-analytics.png, genericize=false,
size=compact. Build it on a canvas about 1040x660, scale fonts/padding to fit,
and make the page a centered bounded card (max-width 1080px, no forced 100vh
height). Print the output paths.
```

## 8. Scale-to-fit (keep layout, shrink to embed)
Keep the current proportions but make it a bounded box for a slide / embed.

```
Generate a diagram. reference=inputs/ai-analytics.png, genericize=false. Keep the
wide layout but wrap the canvas so it scales to fit: max-width 900px,
transform-origin top-left, and remove min-height:100vh from the body so it's a
bounded box, not full-screen. Print the paths.
```

## 9. Resize an existing diagram (don't start over)
Shrink a diagram you already generated.

```
Open the diagram from the latest runs/ folder and regenerate it smaller:
canvas ~1040x660, centered bounded card (max-width 1080px), no full-page height.
Keep the same content, zones, and styling. Re-run the self-verify screenshot and
save into a new runs/<UTC-timestamp>/ folder.
```

---

### Notes
- Drop the inline `# comments` if you like — the agent treats them as side notes.
- `genericize=false` keeps product names as labels; icons are always tasteful
  Lucide glyphs, never brand logos.
- Size: `size=compact|standard|wide` or an explicit `canvas=WxH`. Below ~900px
  wide, dense diagrams get cramped — drop a zone or shorten labels.
