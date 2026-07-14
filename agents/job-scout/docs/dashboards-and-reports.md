# Dashboards & Reports

At the end you will know how to build the two HTML pages this project
produces — the hiring-trends dashboard and the resume-match report —
and what is safe to share.

## The trends dashboard

One self-contained HTML file: stat tiles, a target-role tracker, weekly
trend, salary bands, and a paginated explorer where clicking a row
opens the job description in a side panel. The **?** icon opens
plain-English help for three audiences (readers, data engineers,
developers).

Build it from a trends parquet snapshot:

```bash
python tools/raw_load.py --export
python tools/build_trends_report.py \
    --input exports/ats_raw_trends_20260714.parquet \
    --out exports/hiring-trends-20260714.html
```

Or all in one step with Docker: `docker run --rm ghcr.io/senthilsweb/job-scout trends`.

### How much job-description text to embed (`--jd`)

| Mode | What is embedded | Page size | Use for |
|---|---|---|---|
| `target` (default) | JD text only for postings matching your config keywords | ~6 MB | personal daily use |
| `all` | every JD | ~20+ MB | local deep-dives |
| `none` | no JD text; side panel shows facts + apply link | ~2 MB | **anything you share** |

JD text comes from the sibling full parquet (`--jd-from`, inferred
automatically by replacing `trends` with `full` in the input name). If
the full parquet is missing, the build falls back to `none` with a
warning.

### The public copy

A public build is rebuilt daily in CI and hosted at
<https://senthilsweb.github.io/ai-agents/trends/>. It differs from a
personal build in two enforced ways:

- `--jd none` — zero job-description text (companies' content — see
  [FAQ](faq.md#why-does-the-public-dataset-exclude-job-descriptions)).
- `--no-targets` — zero embedded role keywords. Visitors bring their
  own via the URL: `…/trends/?roles=ai engineer,platform engineer`
  renders the target tracker for exactly those keywords, computed in
  the browser. Without the parameter, the tracker stays hidden.

The public page is never committed to git — the docs workflow builds
it from the committed parquet on every deploy (daily at 11:45 UTC).

### Sharing your own build

The dashboard is a single file — host it anywhere or attach it as a
web artifact. Before sharing outside personal use, rebuild with
`--jd none`: job-description text is the hiring companies' content.
The facts — titles, companies, locations, salary bands — are fine to
share in any mode.

## The match report

The paid pipeline's output: one HTML page ranking every analyzed
posting against your resume — score bands, strengths, gaps, resume
improvements, missing ATS keywords, and a cover letter per job, each in
an expandable row. Jobs first analyzed today get a NEW badge.

```bash
python tools/build_match_report.py --input exports/jobmatch-20260713/all_reports.json \
    --out exports/match-report.html
python tools/daily_match.py    # fetch -> sweep -> render, one command (PAID)
```

Rendering is free — it reads saved results. Only the sweep itself calls
the paid API; the [Runbook](runbook.md#running-the-paid-match) covers
that procedure and its cost guard. Full tool reference:
[API match pipeline](api-match-pipeline.md).

**The match report is personal** — it contains your resume analysis and
generated cover letters. It lands in `exports/` (git-ignored) and
should stay private.

## How the templates work

Both pages render from Jinja2 templates in
[templates/](https://github.com/senthilsweb/ai-agents/tree/main/agents/job-scout/templates)
— data is injected as JSON islands, all CSS/JS is inline, and the
output makes zero network requests. Styling supports light and dark
themes. To change a page, edit its template and re-run the build tool;
no build system involved.

Next: [Runbook](runbook.md).
