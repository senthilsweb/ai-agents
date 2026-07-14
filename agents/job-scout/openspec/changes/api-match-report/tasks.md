# Tasks: api-match-report

## Bolt 1 — report-renderer (independently testable against existing data)
- [x] 1.1 `config.yaml`: add `matcher:` block (api_base, agent_base,
      resume_path, batch_size, export_dir) — no secrets, URLs are public.
- [x] 1.2 `templates/match_report.html.j2`: port the session report
      (tokens, both themes, validated palette, stat tiles, filters,
      score bars, expandable rows) and add the collapsed cover-letter
      `<details>` per job + a "not analyzed" section for failures.
- [x] 1.3 `tools/build_match_report.py`: CLI (`--input`, `--out`,
      `--title`), input contract per design D2 (enriched or raw
      entries), sort by total score, render via Jinja2.
- [x] 1.4 Verify: render `exports/jobmatch-20260713/all_reports.json`,
      open output, confirm ranking matches the session report and every
      job shows its full cover letter collapsed by default. Confirm the
      old report file is untouched.

## Bolt 2 — match-sweep
- [x] 2.1 Schema: create `api_match_result` (idempotent
      `CREATE TABLE IF NOT EXISTS` in the tool) and document it in
      `job_tracker.dbml`.
- [x] 2.2 JD harvest: Ashby board API + Workday CXS detail per open
      posting; header (company/title/location/comp/url) + body; SHA-256
      over the text; persist `.txt` under the day's export dir.
- [x] 2.3 Selection: open AND (never analyzed OR hash changed).
- [x] 2.4 Analyze loop: upload each JD → `/analyze` in batches of 3
      with the configured resume; one retry per batch; write per-job
      JSON immediately; upsert `api_match_result`.
- [x] 2.5 `--backfill <all_reports.json>`: seed table + copy JSONs,
      zero API calls; hashes computed from the saved JD files when
      present, else from a re-harvest, else NULL (forces re-analysis
      on next sweep only if the JD is still live).
- [x] 2.6 Verify: backfill the 2026-07-13 run → 85 rows; immediate
      re-sweep analyzes 0 (or only genuinely new postings); run log
      shows counts.

## Bolt 3 — daily-orchestrator
- [x] 3.1 `tools/daily_match.py`: fetch (`fetch_all`) → sweep → render
      all analyzed jobs to `exports/jobmatch-YYYYMMDD/match-report.html`
      with "new today" badges; `--notify none` seam; timestamped log
      file per run (existing logging config).
- [x] 3.2 README: new "API match pipeline" section (plain English) +
      example launchd/cron line.
- [x] 3.3 Verify: one end-to-end `daily_match.py` run on live data;
      confirm only new/changed jobs hit the API and the dated report
      renders the full ranked set.
