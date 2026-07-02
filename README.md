# ai-agents

A monorepo of small [Vercel Eve](https://vercel.com/eve) agents that share one
runtime kit, plus the **AI SDET Workbench** slide deck that introduces the
workbench architecture behind them. Each agent is filesystem-first: typed tools
do the deterministic work, models only coordinate, and every run records its
data, report, and metrics to a timestamped folder.

```text
ai-agents/
├── agents/
│   ├── api-test-generator/        # OpenAPI spec → Postman collection + Newman run + coverage report
│   ├── diagram-generator/         # description/screenshot → self-contained HTML diagram
│   ├── github-pr-digest/          # PR activity → flat dataset + Markdown digest
│   └── linkedin-cover-generator/  # article → polished LinkedIn cover image
├── ai-sdet-workbench/             # Reveal.js slide deck on the workbench architecture
├── shared/                        # Shared Agent Runtime Kit (workspace package)
├── docs/ARCHITECTURE.md           # one-page architecture overview
└── openspec/adr/                  # architecture decision records
```

## Quickstart

Prerequisites: Node 24+ and Docker (for agents that use a local sandbox).

```bash
nvm use 24
npm install                    # installs every workspace package
```

Each agent has its own `README.md`, `.env.example`, and dev command. To run one:

```bash
cd agents/<agent-name>
cp .env.example .env           # set model + provider keys (and any secrets)
npm run dev
```

Models are **agnostic** and resolved per role from the environment
(`MODEL_<ROLE>_*` → `MODEL_*`, no built-in default). Use a reasoning-class model
for orchestration and a fast non-reasoning model for glue subagents.

## Shared Agent Runtime Kit

`shared/` is a workspace package every agent imports by subpath
(`import { resolveModel } from "shared/lib/model.js"`). It provides:

- **Model resolution** — agnostic, per-role, env-driven.
- **Run folder** — `writeRunArtifact` (host + sandbox mirror) and the canonical
  `sync_run_to_host` copy-back.
- **Usage + cost** — a token-accounting hook and `summary.json` builder.
- **Sandbox** — a base sandbox factory and stopped-container cleanup.

See [`shared/README.md`](shared/README.md) and
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Use a workspace dependency, not a
relative `#shared/*` map (Eve's snapshot follows dependency symlinks).

## Agents

| Agent | What it does |
|---|---|
| [`api-test-generator`](agents/api-test-generator/README.md) | Turns an OpenAPI 3.x spec into a Postman collection with pairwise test coverage, runs it with Newman, and records a coverage report. |
| [`diagram-generator`](agents/diagram-generator/README.md) | Turns a description or reference image into a self-contained HTML architecture diagram. |
| [`github-pr-digest`](agents/github-pr-digest/README.md) | Collects PR activity for repositories over a UTC date range, emits a flat DB-ready dataset, and renders a Markdown digest. |
| [`linkedin-cover-generator`](agents/linkedin-cover-generator/README.md) | Turns an article (file, URL, or pasted text) into a polished LinkedIn cover image with deterministic dimension validation. |

## AI SDET Workbench

[`ai-sdet-workbench/`](ai-sdet-workbench/README.md) is a Reveal.js slide deck
introducing the workbench architecture and concepts — composable skills, agents,
tools, and rules, and the two-phase split between LLM authoring and
deterministic execution — derived from the `api-test-generator` agent.

## Contributing

- Add new agents under `agents/<name>/`; depend on `shared` (`"shared": "*"`)
  for cross-cutting runtime helpers instead of duplicating them.
- Keep prompts, skills, and instructions inside the agent folder. `shared/` is
  for typed helpers and runtime primitives only.
