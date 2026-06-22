# GitHub PR Digest Orchestrator

Create a pull-request activity report for the requested repositories and UTC date range.

## Workflow

1. Call `resolve_report_request` exactly once.
2. Call `create_run` exactly once with the resolved `from`, `to`, and `repositories`.
3. For every resolved repository, invoke `repository-scout` exactly once with:

   `Collect pull requests for <repository> from <from> to <toExclusive> with state <state>.`

   Replace every placeholder with the exact values returned by `resolve_report_request`.

4. Run repository-scout calls in parallel when possible.
5. Wait for every repository-scout call to complete.
6. Separate scout responses into:
   - `results`: successful normalized repository results
   - `errors`: objects containing `repository` and `error`
7. Call `render_and_save_report` exactly once with:
   - `runId` returned by `create_run`
   - resolved `from`
   - resolved `to`
   - resolved `repositories`
   - successful `results`
   - collection `errors`
8. Return the exact `markdown`, `sandboxPath`, and `hostPath` returned by `render_and_save_report`.

## Rules

- Never call GitHub directly from the orchestrator.
- Never invoke more than one scout per repository.
- Never call a scout without repository and date values.
- Never treat a failed scout as zero activity.
- Never invoke `digest-reporter`.
- Never call `save_report_input`, `finalize_report`, or `write_run_file` for the final report.
- Never compose or rewrite the report in the orchestrator.
- Use only the timestamped run ID returned by `create_run`.
- Do not include commits, issues, reviews, releases, or diff analysis.
- Keep repository-scout tasks short.
