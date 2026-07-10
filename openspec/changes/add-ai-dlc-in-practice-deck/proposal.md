# Proposal: Add AI-DLC In Practice Slide Deck

## Why

The current `ai-sdet-workbench/index.html` (8 slides) is aspirational—it describes a generic test-automation workbench architecture using `api-test-generator` as a conceptual example. It does not reflect:

1. **Actual governance implemented** in this monorepo (status lifecycle, approval gates, decision logs in artifacts)
2. **Mob phases and ceremonies** from the AI-DLC methodology (mob elaboration, mob construction, validated progression)
3. **Evals as first-class** production gates (eve's native eval harness, 8 real tests in privacy-classifier reading run artifacts)
4. **Real artifacts** (proposal.md, design.md, tasks.md, .openspec.yaml, security baseline findings) and how they flow through the lifecycle
5. **Security baseline review process** as a documented pre-merge ceremony
6. **Single vs multi-agent patterns** with trade-off analysis (privacy-classifier vs api-test-generator)
7. **Training/override patterns** for composability (engine routing, system prompt precedence)
8. **Observability integration** (OTel dual export, no custom instrumentation)

The workbench deck is useful as a high-level conceptual resource, but stakeholders and future contributors need a **practical, artifact-grounded walkthrough** of how AI-DLC actually works in this repository.

## What changes

- **Rename folder**: `ai-sdet-workbench/` → `ai-dlc-in-practice/` (more meaningful, reflects actual content)
- **Refresh slide deck** to 11 slides (from 8):
  - **Slides 1–10**: New slides covering mob phases, status lifecycle, inception→design→implementation flow, construction+security, evals framework, engine routing, observability, single vs multi-agent patterns
  - **Slide 11**: Original Slide 8 (AI-DLC Glossary) kept verbatim with weblinks to AI-DLC paper, specs.md, fabriqa.ai, dltHub
- **Root artifact**: Use real excerpts from `privacy-classifier` across all slides:
  - proposal.md (Inception: Why, What changes, Impact)
  - design.md (Design: model routing, engine routing, security baseline, telemetry)
  - tasks.md (Construction: task decomposition, corrections, sign-off)
  - .openspec.yaml (Status lifecycle: proposed→approved→implemented→verified)
  - All 8 evals files (Evals framework: integration + unit patterns, artifact assertions)
  - .env.example (Training/override: engine selection, system prompt precedence)
  - detection_prompt.default.md (Default config, changeable without code)
  - Sandbox setup, OTel instrumentation, security findings
- **Evals emphasis**: Throughout the deck, emphasize evals as first-class testing gates (dedicated Slide 6, callouts in Slides 3, 5, 8, 9)
- **Same visual identity**: Retain current reveal.js theme, light/dark toggle, CSS styling, fonts, colors

## Impact

- Establishes a **practical reference** for how to implement AI-DLC in a monorepo (not just theory)
- **First-time deck viewer can trace** a real change from Intent through verified Operations
- **Training resource** for teams adopting privacy-classifier or building similar agents
- **Governance documentation** embedded in a presentation (Inception gate, mob ceremonies, status gates, security review, evals)
- **Future agents** have a pattern to follow (openspec structure, task-driven construction, evals framework)
- **No code changes** to privacy-classifier, api-test-generator, or any agent; this is documentation-only
