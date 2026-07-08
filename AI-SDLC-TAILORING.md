# AI-SDLC Tailoring

This repo follows an AI-assisted SDLC loosely modeled on **AI-DLC** (three
gated phases — Inception, Construction, Operations — with a human approving
each stage before the next starts; see [AI-DLC + Claude Code: The End of
Vibe Coding](https://pub.towardsai.net/ai-dlc-claude-code-the-end-of-vibe-coding-a-complete-hands-on-guide-7e6cf6e026a2))
and on Claude Code's own project-instruction conventions (`AGENTS.md`/
`CLAUDE.md` as always-loaded process docs, ADRs, skills, subagents).

We do **not** implement AI-DLC's full machinery (`.aidlc-rule-details/`, a
mandatory `"Using AI-DLC,"` activation phrase, a rule-file extension system).
This document is the override statement: what we kept, what we deliberately
went lighter-weight on, and why — so the gap between "the full spec" and
"what actually runs in this repo" is a documented judgment call, not an
accident.

## Scope

This process applies to **any non-trivial change anywhere in this
repository** — root-level tooling and config, the `shared/` package,
`openspec/` itself, and every `agents/<name>/` — not just agent code. Folder
location doesn't decide whether a change needs an openspec proposal;
triviality does. A typo fix, a dependency bump, or a doc wording tweak
doesn't need one regardless of where it lives. A new capability, a schema
change, a new cross-cutting shared module, a new CI gate, or anything that
changes what the repo *does* — including at the repo root — does, exactly
the same way `add-privacy-classifier` covered its `shared/` additions
alongside the agent itself.

## Mapping: AI-DLC phase → this repo's artifact

| AI-DLC concept | This repo | Notes |
|---|---|---|
| Requirements doc | `openspec/changes/<name>/proposal.md` (Why / What changes / Impact) | |
| Design doc, pre-code | `openspec/changes/<name>/design.md` | Architecture, model routing, non-goals, and (as of this tailoring pass) a mandatory **Security baseline** section |
| Units / decomposition | `openspec/changes/<name>/tasks.md` | Checklist, not separate per-unit files |
| Formal spec | `openspec/changes/<name>/specs/<capability>/spec.md` | |
| Decision log / `audit.md` | `openspec/adr/*.md` (cross-cutting) + inline `**Correction**:`/`**Sign-off**:` entries in each change's own `tasks.md`/`design.md` | Deliberately not one global log — decisions live next to the artifact they changed, see "Compromises" below |
| Approval gate before Construction | `.openspec.yaml` → `status:` field + `approval:` block | Lifecycle defined below |
| NFR review | Folded into `design.md` (Deployment constraint, Non-goals, Telemetry sections) | No separate NFR document |
| Security Baseline extension | `design.md`'s **Security baseline** section, produced by a `/security-review`-style pass before a change's status can reach `implemented` | Not a standing CI gate yet — see "Compromises" |
| Session continuity marker | `tasks.md` checkboxes + `.openspec.yaml` `status:` | No separate `aidlc-state.md` |
| Operations phase | `openspec/observations/*.md` | Lightweight, post-hoc; no dedicated Operations tooling yet (see "Not yet implemented") |

## Status lifecycle (`.openspec.yaml` → `status:`)

```
proposed → approved → implemented → verified → archived
```

- **proposed** — proposal/design drafted, not yet reviewed by the repo owner.
- **approved** — repo owner has reviewed and approved the design. Construction
  should not meaningfully start before this, going forward (see the process
  gap below for what happens when it does anyway).
- **implemented** — Construction complete: code written, typechecked, and has
  been through a security-baseline pass. Evals exist but have not necessarily
  been run live yet.
- **verified** — the change's own `tasks.md` live-verification tasks (smoke
  run, `eve eval` against a real dev server) have passed.
- **archived** — merged and closed out.

## Compromises — where we went lighter than the full spec, on purpose

- **No `.aidlc-rule-details/` rule engine or activation phrase.** One process
  (openspec) applies uniformly to every agent in this monorepo; there's no
  need for a per-repo-configurable rule-file system when there's only one
  repo and one set of conventions to enforce. `AGENTS.md`/`CLAUDE.md` already
  serve as the always-loaded process doc AI-DLC calls `core-workflow.md`.
- **No single global `audit.md`.** Decisions are logged as `**Correction**:`
  or `**Sign-off**:` entries directly in the change's own `tasks.md`/
  `design.md` (cross-cutting decisions go in `openspec/adr/`). A per-change
  log is easier to keep honest than a monorepo-wide one that every change
  would have to remember to append to.
- **No separate NFR document.** Every change so far has been one agent with a
  handful of non-functional concerns (deployment constraint, telemetry, cost)
  — small enough to fold into `design.md` rather than spin up a second file
  that's usually mostly empty.
- **Security baseline is a triggered pass, not a standing CI gate — yet.** It
  runs as part of getting a change to `implemented` status when the change
  touches untrusted input (uploaded files, host paths, subprocess
  invocations) or handles sensitive data. It is not currently wired into CI
  as an automatic block on every PR. Promote it to a CI gate if/when this
  repo starts taking external contributions or the agent surface grows past
  what a manual pre-merge pass can reliably cover.
- **Operations phase is informal.** `openspec/observations/` captures
  after-the-fact findings (e.g. telemetry/cost verification notes) but there's
  no dedicated Operations tooling, dashboard, or process yet — this repo's
  agents are still pre-production.

## Known process gap (and what changed because of it)

`add-privacy-classifier` was fully built — every implementation task in
`tasks.md` checked off, code typechecking clean — while `.openspec.yaml`
still read `status: proposed`. That's the "vibe coding" failure mode AI-DLC
is explicitly about: Construction ran ahead of an approved Inception gate.
The repo owner reviewed and approved the change retroactively (see that
change's `tasks.md` "Sign-off" section and `.openspec.yaml` `approval:`
block); the status lifecycle above and this document exist so that going
forward, a change's `status:` field is expected to reach `approved` *before*
its `tasks.md` checklist fills in, not after.

## Not yet implemented from the full AI-DLC spec

- A CI-enforced status gate (nothing currently stops code from merging while
  `status: proposed`).
- Formal Operations-phase tooling.
- A reference implementation for treating `security-review` as mandatory
  rather than judgment-call-triggered.

Revisit this document when any of the above stops being "small enough that
lightweight is fine" — e.g. if the number of active changes-in-flight grows
enough that per-change logs stop being discoverable, or if an agent starts
handling production traffic.
