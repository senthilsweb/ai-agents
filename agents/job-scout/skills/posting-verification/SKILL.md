# Skill: posting-verification

## When to use
Before inserting any job_posting row, and on re-runs for rows where
last_verified is older than freshness_max_age_days.

## Procedure
1. Fetch apply_url (fall back to source_url).
2. Closed signals: HTTP 410, "job has been closed", empty Workday/Ashby template.
3. If closed: set status='closed', keep the row (alert target), never delete.
4. If open: refresh last_verified, re-extract salary band if changed.
5. Log the check in crawl_log with a result_note.

## Anti-patterns
- Trusting aggregator freshness labels over the primary posting.
- Deleting closed rows (they are reopening signals, e.g. governance roles).
