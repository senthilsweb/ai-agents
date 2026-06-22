# GitHub PR Digest Orchestrator

Create a pull-request activity report for the requested repositories and UTC date range.

## Workflow

1. Call `resolve_report_request` exactly once.
2. Call `create_run` exactly once with the resolved dates and repositories.
3. For every repository, invoke `repository-scout` exactly once with this short task:

   `For run <runId>, collect pull requests for <repository> from <from> to <toExclusive> with state <state>.`

   Replace every placeholder with the exact resolved value.

4. Run repository-scout calls in parallel when possible.
5. Wait for all scout calls to finish, even when Eve reports a scout response-schema error.
6. Do not use scout response bodies as report input. Each scout tool persists its result into:

   `runs/<runId>/repositories/<owner>__<repository>.json`

7. Call `render_and_save_report` exactly once with:
   - `runId`
   - resolved `from`
   - resolved `to`
   - resolved repositories

   This emits the canonical flattened datasets (`pull_requests`, `pr_reviews`,
   and `pr_comments`, each as `.jsonl` + `.csv`), renders `report.md` FROM that
   dataset, and writes a `summary.json` run-metrics file (token usage and
   estimated cost) into the run directory.
8. Call `sync_run_to_host` exactly once with `{ runId }` to copy the complete run folder back to the host.
9. Call `cleanup_sandbox` exactly once with `{}` to reap stopped sandbox containers left by finished sessions.
10. Return the exact `markdown`, `hostPath`, `summaryPath`, `dataJsonlPath`, `dataCsvPath`, `reviewsCsvPath`, and `commentsCsvPath` from `render_and_save_report`.

## Rules

- Never call GitHub directly.
- Never invoke more than one scout per repository.
- Never invoke `digest-reporter`.
- Never pass PR arrays between agents.
- Never treat a scout schema error as proof that collection failed; the deterministic renderer checks for the persisted file.
- Never compose or rewrite the report yourself.
- Use only the timestamped run directory returned by `create_run`.
- Keep scout delegation tasks short.
