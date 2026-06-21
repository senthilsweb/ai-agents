## Context

The diagram generator currently uses a single model (configured via `MODEL`
env var) for all agent roles. The orchestrator analyzes a reference image,
writes a diagram spec, then delegates HTML rendering and report writing to
copies of itself via Eve's built-in `agent` tool. The built-in `agent` tool
inherits the parent's model — there is no way to specify a different model
for the renderer or reporter.

**Evidence from GLM-5.2 test (2026-06-20):**
- Orchestrator: 12 steps, 5 min, 158K input + 14K output tokens, ~$0.12.
  Reasoning was beneficial — it analyzed the image, extracted structure,
  wrote a detailed spec.
- Renderer (subagent): 1 step, 50+ min, 131 output tokens. Never produced
  HTML. The reasoning model got stuck in infinite chain-of-thought computing
  node coordinates and edge routes.

Eve's architecture offers two delegation mechanisms:
1. **Built-in `agent` tool** (copy-of-self): inherits parent model, shares
   parent sandbox, parent hooks fire. No model override possible.
2. **Declared subagents** (`agent/subagents/<id>/`): each has own `agent.ts`
   with own model, own skills, own instructions. Gets **isolated sandbox**
   (does NOT share parent's Docker container). Parent hooks do NOT fire for
   declared subagent sessions.

## Goals / Non-Goals

**Goals:**
- Allow the orchestrator to use a reasoning model (e.g. GLM-5.2) for
  image analysis and spec writing.
- Allow the renderer and reporter subagents to use a non-reasoning model
  (e.g. GLM-4.5-Air) for fast HTML/report generation.
- Per-role env overrides: `MODEL_ORCHESTRATOR`, `MODEL_RENDERER`,
  `MODEL_REPORTER` (with `_BASE_URL` and `_API_KEY` variants), falling back
  to the existing `MODEL` / `MODEL_BASE_URL` / `MODEL_API_KEY` globals.
- Preserve token/cost observability across all roles.
- Preserve the `runs/` folder as the artifact exchange point.

**Non-Goals:**
- Dynamic model switching mid-session (model is fixed per role at startup).
- Per-step model selection within a single agent.
- Supporting different providers for orchestrator vs subagents in the same
  run (technically possible via env, but not a design goal — the primary
  use case is same provider, different models).
- Changing the sandbox backend (Docker + Playwright remains).

## Decisions

### D1: Use declared subagents instead of built-in `agent` tool

**Decision:** Switch renderer and reporter from copy-of-self (built-in
`agent` tool) to declared subagents (`agent/subagents/renderer/`,
`agent/subagents/reporter/`).

**Rationale:** The built-in `agent` tool has no `model` parameter — it
always inherits the parent's model. Declared subagents each get their own
`agent.ts` where we can construct a different model from env vars. This is
the only Eve-native way to run different models per role.

### D2: Sandbox isolation — rely on workspace template seeding

**Decision:** Accept that declared subagents get isolated sandboxes. The
`runs/` folder is part of the workspace template (`agent/sandbox/workspace/`),
so it is seeded into every subagent's sandbox at creation time.

**Mechanism:**
1. Orchestrator writes `spec.json`, `run-meta.json` to `runs/<run_id>/`
   via `write_run_file` tool (which proxies into the orchestrator's sandbox).
2. Orchestrator delegates to `subagent(renderer, …)` with a message
   containing the run_dir path.
3. The renderer's sandbox is created from the workspace template, which
   includes the `runs/` folder — but ONLY files that existed when the
   template was last built. **Files written during the current session are
   NOT in the template.**

**Critical issue:** The renderer needs to read `spec.json` that the
orchestrator just wrote. With isolated sandboxes, the renderer's sandbox
won't have it. Options:
- **Option A**: The orchestrator passes the full spec content in the
  subagent message (not just the path). The renderer writes it to its own
  sandbox, then processes it. — **Chosen**: simplest, no Eve framework
  changes needed, spec is ~7KB which fits in a message.
- **Option B**: Use a shared volume mount between containers. — Rejected:
  requires custom Docker configuration, not Eve-native.
- **Option C**: Write spec to a host-mounted path outside the sandbox. —
  Rejected: breaks sandbox isolation model.

**With Option A**, the orchestrator includes the full spec JSON in the
subagent delegation message. The renderer writes it to its own sandbox
via `write_run_file`, then reads it back and processes it. The renderer
writes `diagram.html` to its own sandbox's `runs/` folder. The
orchestrator cannot directly read the renderer's output — the renderer
must return the HTML content in its response message, and the orchestrator
writes it to its own sandbox.

### D3: Hooks for declared subagents

**Decision:** Copy the usage hook into each subagent's `hooks/` directory.
Eve discovers hooks per-agent from `agent/hooks/` (for the main agent) and
`agent/subagents/<id>/hooks/` (for declared subagents).

**Rationale:** Declared subagent sessions do not trigger the parent's
hooks. Each subagent needs its own hook instance to capture token usage.
The hook writes to `$TMPDIR/eve-usage/<sessionId>.json` using the session
ID, which is unique per subagent session — no collision with parent.

### D4: Tools for declared subagents

**Decision:** Each subagent gets the tools it needs in its own `tools/`
directory:
- Renderer: `write_run_file`, `read_run_file`, `fetch_lucide_icon`,
  `render_screenshot`, `read_usage`
- Reporter: `write_run_file`, `read_run_file`, `read_usage`

**Rationale:** Declared subagents don't inherit the parent's tools. Each
must declare its own. The `create_run` tool is orchestrator-only.

### D5: Skills for declared subagents

**Decision:** Copy relevant skills into each subagent's `skills/` directory:
- Renderer: `design_system.md`, `render_diagram.md`
- Reporter: `write_report.md`, `cost_rates.md`, `report_template.md`

**Rationale:** Eve scopes skills per-agent. Declared subagents only see
their own `skills/` directory.

### D6: Environment variable hierarchy

**Decision:** Per-role vars override global vars:

```
MODEL_ORCHESTRATOR         → MODEL         → (hardcoded default)
MODEL_ORCHESTRATOR_BASE_URL → MODEL_BASE_URL → (hardcoded default)
MODEL_ORCHESTRATOR_API_KEY  → MODEL_API_KEY  → (hardcoded default)

MODEL_RENDERER             → MODEL         → (hardcoded default)
MODEL_RENDERER_BASE_URL    → MODEL_BASE_URL → (hardcoded default)
MODEL_RENDERER_API_KEY     → MODEL_API_KEY  → (hardcoded default)

MODEL_REPORTER             → MODEL         → (hardcoded default)
MODEL_REPORTER_BASE_URL    → MODEL_BASE_URL → (hardcoded default)
MODEL_REPORTER_API_KEY     → MODEL_API_KEY  → (hardcoded default)
```

**Rationale:** Backward compatible — if only `MODEL` is set, all roles use
the same model (current behavior). Setting per-role vars enables the new
behavior.

## Risks / Trade-offs

### R1: Sandbox isolation breaks file sharing
**Risk:** Declared subagents can't read files written by the orchestrator
in real-time. The renderer can't read `spec.json` from the orchestrator's
sandbox.
**Mitigation:** Pass full spec content in the subagent message (D2, Option
A). The renderer writes it locally, then processes it. The renderer returns
the full HTML content in its response, and the orchestrator writes it to
its own sandbox.
**Trade-off:** Message sizes increase (~7KB for spec, ~20-50KB for HTML
response). This is within LLM context limits.

### R2: Hook duplication
**Risk:** The usage hook must be copied to each subagent. If the hook
logic changes, all copies must be updated.
**Mitigation:** Keep the hook simple and identical across all agents.
Consider a shared `agent/lib/` import if Eve supports it (verify in Eve
docs).

### R3: Sandbox template rebuilds from .DS_Store
**Risk:** `.DS_Store` file changes trigger sandbox template rebuilds in
dev mode, which can disrupt active runs (this caused the reporter to get
stuck in a previous test).
**Mitigation:** Add `.DS_Store` to sandbox exclusion patterns or
`.dockerignore`. This is a pre-existing issue, not introduced by this
change, but should be fixed alongside it.

### R4: Double token cost for spec/HTML passing
**Risk:** Passing full spec content in the subagent message and full HTML
in the response means those tokens are counted as input/output for both
the orchestrator (sending/receiving) and the subagent (receiving/sending).
**Mitigation:** Accept the overhead. Spec is ~7KB (~2K tokens), HTML is
~20-50KB (~5-12K tokens). At GLM-4.5-Air pricing ($0.20/M input), this
adds < $0.01 per run.

### R5: Eve version compatibility
**Risk:** Declared subagents are an Eve feature that may change in future
versions. The current implementation is tested against Eve 0.11.7.
**Mitigation:** Pin Eve version in `package.json`. Test against new
versions before upgrading.
