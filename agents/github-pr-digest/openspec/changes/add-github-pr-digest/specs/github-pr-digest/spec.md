# GitHub PR Digest Specification

> Conforms to `ai-agents/openspec/adr/0001-shared-agent-runtime-kit.md` and
> `ai-agents/openspec/adr/0002-cost-matrix.md`. Report assembly is a deterministic
> code tool (not an LLM subagent). The agent is model-agnostic: every model is
> resolved from environment per role; no model id is hard-coded.

## Requirement: Resolve report request

The system SHALL accept zero or more explicitly supplied repositories, an optional start, an optional end, and a PR state filter.

- When repositories are omitted, it SHALL read `GITHUB_REPOSITORIES` as a JSON string array.
- When dates are omitted, it SHALL select the previous UTC calendar day.
- Date-only end values SHALL include the complete specified UTC day.
- Invalid repositories or intervals SHALL fail before any GitHub call.

## Requirement: Collect repository activity

The system SHALL invoke one Repository Scout per repository.

- Each scout SHALL call the GitHub REST API using `GITHUB_TOKEN`.
- Each scout SHALL paginate deterministically and return normalized JSON.
- A PR SHALL match when its create, update, close, or merge timestamp falls inside the interval.
- The scout SHALL not summarize or infer meaning from PR content.

## Requirement: Combine results

The system SHALL combine repository results using a deterministic report tool (`render_and_save_report`), not an LLM subagent.

- The tool SHALL read each persisted per-repository JSON file from the run directory.
- The tool SHALL include every requested repository.
- The tool SHALL include every supplied PR exactly once.
- Totals SHALL derive only from supplied deterministic counts.
- Repository failures SHALL be reported without discarding successful results.
- The orchestrator SHALL NOT compose, summarize, or rewrite the report itself.

## Requirement: Persist output

The system SHALL save the final Markdown under the timestamped `runs/<run-id>/` directory in the sandbox workspace and return the same Markdown to interactive callers.

- A single `sync_run_to_host` step SHALL copy the run directory from the sandbox to the host workspace; deterministic tools SHALL NOT write to the host directly.

## Requirement: Emit run metrics

The system SHALL write `runs/<run-id>/summary.json` for every run.

- It SHALL record token usage (`input`, `output`, `total`, `by_phase`, `source`) from the shared usage hook.
- It SHALL record estimated cost (`currency`, `mode`, `total`, `by_phase`, `estimated`) computed from the shared cost matrix.
- When a run is aborted by a loop or wall-clock budget, `summary.json` SHALL still be written with `source: "partial"`.

## Requirement: Model selection and cost guardrails

The system SHALL select models per role from environment and bound runtime cost. It SHALL NOT hard-code any model id or provider.

- The orchestrator SHALL use a **reasoning-class** model resolved from `MODEL_ORCHESTRATOR`.
- The Repository Scout SHALL use a **fast, non-reasoning-class** model resolved from `MODEL_SCOUT`, because the model performs glue only. A heavy reasoning model on the scout is prohibited: it risks runaway chain-of-thought and infinite loops on a deterministic glue task.
- Every role SHALL resolve `MODEL_<ROLE>_* → MODEL_* → ` an explicit failure when unset; there SHALL be no built-in default model id.
- Provider base URL and API key SHALL be configurable per role (`MODEL_<ROLE>_BASE_URL`, `MODEL_<ROLE>_API_KEY`).
- The agent SHALL remain model-agnostic: any model or provider can be swapped via `.env` alone, using Eve's model and AI-gateway adapters. No code change SHALL be required to change models.
- The orchestrator SHALL enforce a step/turn ceiling and wall-clock budget to prevent infinite loops or runaway reasoning.

## Requirement: Scheduled execution

The root agent SHALL define a daily schedule at 01:00 UTC that processes the previous UTC day using configured repositories.
