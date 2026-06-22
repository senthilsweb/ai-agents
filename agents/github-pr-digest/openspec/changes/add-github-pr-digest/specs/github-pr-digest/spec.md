# GitHub PR Digest Specification

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

The system SHALL invoke one Digest Reporter after repository collection completes.

- The reporter SHALL include every repository.
- The reporter SHALL include every supplied PR exactly once.
- Totals SHALL derive only from supplied deterministic counts.
- Repository failures SHALL be reported without discarding successful results.

## Requirement: Persist output

The system SHALL save the final Markdown under `reports/` in the sandbox workspace and return the same Markdown to interactive callers.

## Requirement: Scheduled execution

The root agent SHALL define a daily schedule at 01:00 UTC that processes the previous UTC day using configured repositories.
