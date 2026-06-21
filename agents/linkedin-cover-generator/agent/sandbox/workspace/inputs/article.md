# Building Diagram Agents at Scale: Orchestrator + Sub-Agents Pattern

Sketching architecture on paper and pencil, then snapping a quick phone photo, is a lean habit worth keeping. It keeps design discussions moving instead of stalling inside a diagramming tool — draw it, snap it, move on. The problem has always been the same: those rough photos rarely turn into clean, shareable diagrams.

A diagram agent closes that gap. It converts a whiteboard sketch — or even a one-line architecture description — into a polished, self-contained HTML diagram in a consistent house style, not a throwaway mermaid or ASCII block. Building one takes more than a single agent loop: an orchestrator to coordinate, specialized sub-agents to render variations, and a reporter to track every run. This is where the multi-agent pattern becomes essential.

A version of this agent was built using pure markdown files — orchestrator and sub-agents defined in text, each able to run a different model, every run recorded in a metrics folder. It worked well. On June 17, when Vercel open-sourced **eve** — a filesystem-first framework for durable agents — the markdown version was ported over. That comparison is useful: it shows exactly when a markdown approach is enough, and when a framework earns its place.

## What it does

Give the agent a reference image — or just describe an architecture — and it generates a stunning architecture diagram on an HTML canvas with a glossy effect, rebuilding the boxes, connections, and labels in a clean dark style with simple icons. Settings like theme, size, and fit are read straight from the prompt. To switch the AI model, change a single line in `.env`.

## The pipeline

`[ placeholder: orchestrator → sub-agents (renderers + reporter) diagram ]`

The orchestrator writes a spec and fans out renderers, one per variation; a reporter aggregates the traces. Every run leaves a timestamped folder behind — spec, HTML, screenshot, token counts, and a report.

## Example: a diagram from one prompt

A reference image is dropped into the `inputs/` folder, then described in a single line:

> Generate a standard-size diagram from reference=inputs/ai-analytics.png, fit=card, title="AI Analytics Platform".

**Input — a rough reference:**

`[ placeholder image: hand-drawn / screenshot reference ]`

**Output — what the agent produced:**

`[ placeholder image: rendered dark-glass architecture diagram ]`

No image is required. A description alone also works:

> Generate a wide diagram of a 3-tier web app: ALB → ECS services → RDS + ElastiCache.

## File-based vs. eve

| Capability | File-based (markdown) | eve |
| --- | --- | --- |
| Setup | Plain markdown files | Directory convention + typed tools |
| Execution | Restarts from scratch on failure | Durable, checkpointed, resumes |
| Code execution | Shares the app runtime | Isolated sandbox per agent |
| Tool calls | Model best-effort | Typed TypeScript tools |
| Per-sub-agent model | Supported | Single shared model (copy-of-self) |
| Versioning & evals | Manual | Git diffs + CI evals |
| Best for | Fast experimentation | Reliable, reproducible production |

One honest trade-off stands out: the file-based version could run a different model per sub-agent. eve's fan-out uses copies of one agent sharing a sandbox, so they share a single model. That flexibility is exchanged for durability and a shared filesystem — a fair trade when reliability matters more than per-step model choice.

## The takeaway

Markdown instructions are ideal for getting an idea working. A framework earns its place when the work has to be reliable, observable, and reproducible. The boilerplate that once took days — durability, sandboxes, tracing — is now a directory convention. What remains is the only part that was ever the point: the rules.

Start simple. Reach for the framework when the work demands it.

🔗 github.com/senthilsweb/agent-diagram-generator
🔗 vercel.com/eve

Which internal workflow deserves a durable agent first — and would a markdown prompt have been enough?

#AIAgents #eve #Vercel #AINativeDevelopment #DeveloperTools