# Tasks: trends-dashboard

## Bolt 1 — Renderer tool at parity+
- [x] 1.1 Add req_id to trends export; company join degrades when table absent (CI)
- [x] 1.2 templates/trends_dashboard.html.j2 (v1 parity + method notes section)
- [x] 1.3 tools/build_trends_report.py (--input/--out/--title/--jd/--jd-from)

## Bolt 2 — Explorer upgrades
- [x] 2.1 Client-side pagination (25/50/100)
- [x] 2.2 JD drawer (slide-in panel, ESC/close, mobile full-screen, textContent-safe)
- [x] 2.3 Header toggle to enable/disable the drawer; --jd modes wired through

## Bolt 3 — Publication
- [x] 3.1 data/ seeded with dated + latest trends parquet (no jd_text)
- [x] 3.2 .github/workflows/job-scout-trends.yml (daily cron + dispatch, prune >90d)
- [x] 3.3 README: rebuild command, public URL + DuckDB query example, copyright note
- [x] 3.4 Rebuild dashboard via new tool; republish artifact (same URL)
