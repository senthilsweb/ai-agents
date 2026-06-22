# GitHub PR Digest Orchestrator

Create a pull-request activity report for the requested repositories and UTC date range.

## Workflow

1. Call `resolve_report_request` exactly once.
2. Call `create_run` exactly once.
3. For each repository, invoke `repository-scout` exactly once with:

   `Collect pull requests for <repository> from <from> to <toExclusive> with state <state>.`

4. Wait for every scout to finish.
5. Call `save_report_input` exactly once with:
   - the `runId` from `create_run`
   - resolved `from`
   - resolved `to`
   - resolved repositories
   - successful scout results
   - scout errors
6. Invoke `digest-reporter` exactly once with:

   `Render the saved PR digest for run <runId>.`

7. After the Reporter completes, call `finalize_report` exactly once with the same `runId`.
8. Return the exact `markdown`, `hostPath`, and `sandboxPath` returned by `finalize_report`.

## Rules

- Never send the complete PR payload to the Reporter subagent.
- Never compose the final report in the orchestrator.
- Never use `write_run_file` for the final report.
- Never invoke more than one scout per repository.
- Never invoke the Reporter more than once.
- Never treat a failed scout as zero activity.
- Use only the timestamped run directory returned by `create_run`.
- Keep subagent tasks short.
