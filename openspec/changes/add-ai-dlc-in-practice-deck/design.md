# Design

## Architecture

```
ai-dlc-in-practice/ (renamed from ai-sdet-workbench/)
├── pii-classifier/
│   └── index.html (11-slide reveal.js deck, refreshed)
├── (no supporting JS/CSS — all inline, self-contained)
└── (no /images, /data, or external dependencies beyond CDN reveal.js)
```

**Correction (2026-07-09, repo owner):** the deck moved from
`ai-dlc-in-practice/index.html` into its own subfolder
`ai-dlc-in-practice/pii-classifier/index.html`, so each teaching example
gets a sibling folder (`job-matcher/` added by the `add-job-matcher`
change).

Minimal footprint: single HTML file, no build step, open in browser or deploy to static hosting.

## Slide Structure (11 slides, artifact-grounded)

1. **Cover** — "AI-DLC in Practice: From Intent to Operations"
   - Real title reflecting actual content, not test-automation theory
   - Three cover cards: Mob phases, Status lifecycle, Evals framework
   - Badges: Privacy-classifier as proof

2. **Mob Phases — Elaboration & Construction**
   - Two-column: LEFT (Mob Elaboration with proposal.md excerpts), RIGHT (Mob Construction with design.md + tasks.md excerpts)
   - Real artifacts: proposal.md (Why, What changes), design.md (model routing, engine routing), tasks.md (checklist, Sign-off)
   - Gate: `.openspec.yaml` status field progression

3. **Status Lifecycle — Governance in Markdown**
   - Visual: proposed → approved → implemented → verified → archived
   - Real .openspec.yaml excerpt with status, approval block, retroactive note
   - Key callout: status field gates code promotion; no silent defaults

4. **Inception → Design → Implementation Flow**
   - Three-column: proposal.md → design.md → tasks.md
   - Full excerpts from each file
   - Decisions logged as `**Sign-off**:` and `**Correction**:` entries
   - Engineer reviews, blocks unsound decisions

5. **Construction: From Design to Verified Code**
   - Left: Task progression (design approved → code → typecheck → security review → evals → status:implemented)
   - Right: Real security findings table (shell injection, file confinement, quote breakout)
   - Key: All findings documented in design.md, fixes verified

6. **Evals Framework — Eve's Native Testing Harness** ⭐ **EMPHASIZED**
   - Left: All 8 evals (integration vs unit, descriptions)
   - Right: Real code examples (defineEval(), extractRunId(), readRunJson() patterns)
   - Key callout: Evals read actual run artifacts; no LLM in evals; eve's first native adopter
   - Metadata: timeoutMs, fixture staging, tool verification

7. **Engine Routing & Training/Override Patterns**
   - Left: 4 swappable backends (presidio, presidio_genai, genai_only, openai_privacy_filter TODO)
   - Right: System prompt precedence chain (per-invocation → PII_SYSTEM_PROMPT → PII_SYSTEM_PROMPT_FILE → default)
   - Real .env.example excerpts showing config precedence
   - Real detection_prompt.default.md (default system prompt)
   - Ops example: retune without code change

8. **Security Baseline — Pre-Merge Review Process**
   - Full table of 3 findings: shell injection (HIGH 9/10), file read (HIGH 9/10), quote breakout (MEDIUM hardening)
   - Root cause, fix, status for each
   - Signed off by repo owner, date logged
   - Key: Pre-merge gate, not CI automation (yet)

9. **Observability — OTel + Dual Export**
   - Left: Telemetry architecture (AI SDK native spans + custom wrapping, dual export to Phoenix + OpenObserve)
   - Right: Real span structure tree (trace hierarchy, nested spans, metadata)
   - Cost tracking: post-hoc from summary.json
   - Key callout: No custom instrumentation, one pipeline, two backends

10. **Single-Agent vs Multi-Agent Patterns**
    - Left: Privacy-classifier (single orchestrator, direct generateObject, no subagents)
    - Right: API-test-generator (Sonnet + Opus + Haiku, multi-agent, subagent sandboxes)
    - Comparison table: latency, tracing, reasoning, cost, modularity, testing
    - Trade-offs: when to use each pattern

11. **AI-DLC Glossary — The New Vocabulary** (Original Slide 8, KEPT VERBATIM)
    - Existing table: Intent, Mob elaboration, Unit of work, Mob construction, Bolt, Deployment unit, Production
    - Existing weblinks: AI-DLC paper, specs.md, fabriqa.ai, dltHub, your repo
    - Existing closing note: "AI-DLC rebuilds the SDLC from first principles"
    - No changes to this slide (preserves reference value)

## Visual Design (Retained from Current)

- **Theme**: Dark mode (navy #0a0f24) with light/dark toggle
- **Colors**: Cyan (#3ec9d6), purple (#8b5cf6), green (#10b981), amber (#f59e0b), red (#ef4444)
- **Font**: Inter (sans-serif), monospace (SF Mono / Menlo / Consolas for code)
- **Components**: Kickers, panels, tables, code blocks, two-column/three-column grids, phase cards, skills cards, phase-grid cards, asset cards, note bands
- **Animations**: Fade transitions, no distracting effects
- **Reveal.js version**: 5.1.0 (CDN)

## Content Strategy (Artifact-Grounded)

Every statement about privacy-classifier backed by a real file excerpt:

| Slide | File Source(s) |
|-------|---|
| 2 | proposal.md, design.md, tasks.md, .openspec.yaml |
| 3 | .openspec.yaml |
| 4 | proposal.md, design.md, tasks.md |
| 5 | tasks.md, design.md (Security baseline section) |
| 6 | evals/*.eval.ts, evals/lib/run_result.ts |
| 7 | design.md (Engine routing, Telemetry), .env.example, detection_prompt.default.md |
| 8 | design.md (Security baseline section) |
| 9 | design.md (Telemetry section), .env.example, agent/instrumentation.ts pattern |
| 10 | design.md (Loop policy), agent/tools/detect_privacy_entities.ts, api-test-generator patterns |
| 11 | (Current Slide 8, unchanged) |

## Evals Emphasis (Throughout)

- **Slide 6**: Dedicated slide, all 8 evals, real code, artifact assertions
- **Slide 3**: Status lifecycle shows evals as gate before verified
- **Slide 5**: Task progression includes "✓ 8 evals written & integrated"
- **Slide 8**: Security review mentions evals catch security fixes (columnar_rejection.eval.ts)
- **Slide 9**: Evals create spans feeding OTel — testing + observability unified
- **Callout box** (near Slide 6 footer): "Evals are production gates, not post-hoc checks"

## Non-Goals

- No agent code changes, no new dependencies, no shared/ updates
- No separate documentation files (all content in HTML)
- No diagram generation or asset creation
- No TypeScript or build step

## Deployment & Hosting

The HTML file is self-contained (reveal.js via CDN, Iconify via CDN, fonts via Google Fonts). Can be:
- Served from `ai-dlc-in-practice/index.html` in the repo
- Deployed to GitHub Pages or static hosting
- Opened directly in a browser (file:// protocol, with --allow-file-access-from-files for local testing)
