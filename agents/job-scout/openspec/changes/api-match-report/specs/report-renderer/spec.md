# Spec: report-renderer

## ADDED Requirements

### Requirement: Template-driven rendering from a JSON path
`tools/build_match_report.py` SHALL accept `--input <json path>` and
`--out <html path>` and render a single self-contained HTML file from
`templates/match_report.html.j2`. No HTML SHALL be built in Python
strings; changing the page's look SHALL require touching only the
template.

#### Scenario: Regenerate from a saved run
- **WHEN** the tool runs against `exports/jobmatch-20260713/all_reports.json`
- **THEN** it writes a complete ranked report without any API or LLM call

### Requirement: Input contract accepts enriched and raw entries
The input SHALL be a JSON list whose elements are either enriched
records (job-scout metadata + a `report` key holding one `JobReport` or
`JobFetchFailure`) or bare `JobReport`/`JobFetchFailure` objects as
returned by `POST /analyze`. For raw entries the renderer SHALL fall
back to `analysis.job_title` and omit the apply link.

#### Scenario: Raw API response replay
- **WHEN** the input file is the unmodified JSON body of one `/analyze` call
- **THEN** the report renders with titles from the analysis payload and no crash

### Requirement: Ranked, filterable, both themes
Analyzed jobs SHALL be ordered by `score_breakdown.total_score`
descending. The page SHALL provide company and match-band filters,
score-breakdown bars with a legend, summary stat tiles, and light/dark
themes driven by CSS tokens (`prefers-color-scheme` plus a
`data-theme` override in both directions).

#### Scenario: Filter to one company
- **WHEN** the reader clicks a company chip
- **THEN** only that company's rows stay visible and clicking again clears the filter

### Requirement: Cover letter collapsible inside each job row
Every analyzed job's expanded panel SHALL contain a "Cover letter"
`<details>` section, collapsed by default, showing the complete
`cover_letter_text` verbatim. A job whose report has no non-empty
`cover_letter_text` SHALL omit the section entirely — no empty block.

#### Scenario: Reading a cover letter
- **WHEN** the reader expands a job row and then the cover-letter section
- **THEN** the full rendered letter from the API response is shown unmodified

### Requirement: Failures are listed, not dropped
`JobFetchFailure` entries in the input SHALL render in a "not analyzed"
section at the end of the report with their `job_source` and `reason`.

#### Scenario: A JD upload path stopped resolving
- **WHEN** the input contains a failure entry with a reason string
- **THEN** the report shows that job under "not analyzed" with the reason
