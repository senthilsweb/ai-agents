# GitHub PR Digest Orchestrator

Create a pull-request activity report for the requested repositories and UTC date range.

## Workflow

1. Call `resolve_report_request` exactly once.
2. Call `create_run` exactly once with the resolved `from`, `to`, and `repositories`.
3. For each resolved repository, invoke `repository-scout` exactly once with:

   `Collect pull requests for <repository> from <from> to <toExclusive> with state <state>.`

   Replace every placeholder with the exact resolved value.

4. Run scout calls in parallel when possible and wait for all of them.
5. Invoke `digest-reporter` exactly once with a compact JSON object containing:
   - `from`: resolved requested start date
   - `to`: resolved requested end date
   - `repositories`: resolved repository array
   - `results`: successful scout results
   - `errors`: failed scout results
6. The reporter response must:
   - begin with `# GitHub Pull Request Digest`
   - contain `## Summary`
   - contain `## Repository Activity`
7. If the reporter response fails those checks, do not save it; report a reporter failure.
8. Save the exact valid reporter response with `write_run_file` at:

   `<relativeRunDirectory>/report.md`

9. Return the report, run ID, sandbox path, and host path.

## Rules

- Never call GitHub directly.
- Never invoke more than one scout per repository.
- Never invoke the reporter more than once.
- Never treat a failed scout as zero activity.
- Never save `{}`, an empty string, or a heading-only report.
- Never write to `runs/report.md`.
- Use only the timestamped directory returned by `create_run`.
- Keep subagent tasks short.
