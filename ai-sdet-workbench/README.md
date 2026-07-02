# AI SDET Workbench Slide Deck

A Reveal.js presentation introducing the AI SDET Workbench architecture and concepts.

## View the Deck

Open `index.html` in a browser, or serve it locally:

```bash
# Using Python
python -m http.server 8000

# Using Node
npx serve .
```

Then navigate to `http://localhost:8000`

## Features

- **8 slides** covering workbench architecture, two-phase separation, toolkit components
- **Dark/Light theme toggle** (top-left button)
- **Keyboard navigation**: Arrow keys, Space, F (fullscreen), O (overview)
- **PDF export**: Add `?print-pdf` to URL and print to PDF

## Slide Overview

1. **Cover** - AI SDET Workbench introduction
2. **Architecture** - Composable Skills, Agents, Tools, Rules structure
3. **Why This Workbench** - Pain points vs. workbench solutions
4. **Two-Phase Architecture** - Authoring (LLM) vs. Execution (Deterministic)
5. **Five Toolkit Assets** - Skills, Agents, Tools, Rules, Subagents
6. **Toolkit Components** - Real files from api-test-generator agent
7. **Repo Map** - ai-agents monorepo structure
8. **AI-DLC Glossary** - Intent, Bolt, Unit of Work terminology

## Technology

- [Reveal.js 5.1.0](https://revealjs.com/) - Presentation framework
- [Inter](https://fonts.google.com/specimen/Inter) - Typography
- [Iconify](https://iconify.design/) - Icons (MDI set)
- CSS custom properties for theming

## Based On

Content derived from the [api-test-generator](../agents/api-test-generator) agent architecture.
