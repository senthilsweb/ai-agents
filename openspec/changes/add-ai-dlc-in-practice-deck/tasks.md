# Tasks

## Build Tasks

- [ ] Rename folder: `ai-sdet-workbench/` → `ai-dlc-in-practice/`
- [ ] Copy current `ai-sdet-workbench/index.html` as base template (retain CSS, theme, reveal.js setup)
- [ ] **Slide 1 (Cover)**: Update title to "AI-DLC in Practice: From Intent to Operations"
- [ ] **Slide 2 (Mob Phases)**: Two-column layout with real excerpts (proposal.md, design.md, tasks.md, .openspec.yaml)
- [ ] **Slide 3 (Status Lifecycle)**: Visual progression diagram + real .openspec.yaml excerpt
- [ ] **Slide 4 (Flow)**: Three-column layout (proposal.md → design.md → tasks.md) with full excerpts
- [ ] **Slide 5 (Construction + Security)**: Left task progression, right security findings table (shell injection, file read, quote breakout)
- [ ] **Slide 6 (Evals Framework)**: Left all 8 evals, right real code (defineEval, extractRunId, readRunJson) + helper. Add callout: "Evals are production gates"
- [ ] **Slide 7 (Engine + Training)**: Left engine routing table (4 backends), right system prompt precedence chain + .env.example + detection_prompt.default.md
- [ ] **Slide 8 (Security Baseline)**: Full findings table with root causes, fixes, status. Sign-off block.
- [ ] **Slide 9 (Observability)**: Left telemetry architecture, right trace span tree + OTel dual export + cost tracking
- [ ] **Slide 10 (Single vs Multi)**: Left privacy-classifier (no subagents), right api-test-generator (Sonnet/Opus/Haiku). Comparison table.
- [ ] **Slide 11 (Glossary)**: Keep current Slide 8 verbatim (with weblinks to AI-DLC paper, specs.md, fabriqa.ai, dltHub, repo)
- [ ] Update footer: slide count (11 / 11) + slide number, consistent with current style
- [ ] Evals emphasis callouts: Slide 3 (gate), Slide 5 (checklist), Slide 8 (security), Slide 9 (observability)
- [ ] Typecheck HTML for syntax errors (no build step, but verify structure)
- [ ] Test reveal.js navigation (arrow keys, spacebar, slide numbers)
- [ ] Test light/dark theme toggle
- [ ] Verify all code blocks are readable (monospace, syntax highlighting ready)
- [ ] Verify all inline weblinks work (AI-DLC, specs.md, fabriqa.ai, dltHub, github.com/senthilsweb/ai-agents)

## Verification (Live Testing)

- [ ] Manual browser test: load index.html, all 11 slides present, no console errors
- [ ] Theme toggle: light ↔ dark works, localStorage persists
- [ ] Keyboard nav: arrow keys, spacebar, slide jump (Esc → slide picker)
- [ ] Responsive: test on desktop, tablet, mobile (or note breakpoints)
- [ ] Code snippets: readable, no line wrapping issues, monospace font consistent
- [ ] Excerpts: spot-check real file paths (privacy-classifier proposal.md, design.md, tasks.md) for accuracy

## No-Go Criteria

- Any slide missing or blank
- Code blocks not readable (formatting broken, lines cut off)
- Weblinks dead or pointing to wrong resources
- Theme toggle broken or doesn't persist
- Reveal.js navigation broken (slides don't advance)
- Typos in AI-DLC terminology (Mob elaboration, Mob construction, Unit of work, Bolt, Deployment unit, Production, Intent)
