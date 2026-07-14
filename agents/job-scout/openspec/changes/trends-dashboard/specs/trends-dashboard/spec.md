# Spec: trends-dashboard renderer

## Requirement: Reproducible render
The dashboard SHALL be produced by `tools/build_trends_report.py` from a
trends parquet and the Jinja template, with no network access at render
or view time.

#### Scenario: Dated rebuild
- **WHEN** `build_trends_report.py --input exports/ats_raw_trends_20260714.parquet --out exports/hiring-trends-20260714.html` runs
- **THEN** the output is a single self-contained HTML file embedding all rows, config keywords, and (per --jd mode) JD text

## Requirement: JD embedding modes
The tool SHALL support `--jd target|all|none` (default target), sourcing
JD text from the full parquet and keying it by (company_name, req_id).

#### Scenario: Target mode
- **WHEN** built with `--jd target`
- **THEN** only rows whose title matches config title_keywords carry JD text, and the drawer for other rows shows metadata plus the apply link

## Requirement: Explorer pagination and drawer
The table SHALL paginate client-side (25/50/100) and row click SHALL
open a right-side panel (full-screen under 700px) with posting metadata
and JD text when embedded; a header toggle SHALL disable the drawer.

#### Scenario: Drawer disabled
- **WHEN** the "JD panel" toggle is off
- **THEN** row clicks do nothing and only the apply link navigates

## Requirement: Method disclosure
The page SHALL document its normalizations: category bucketing rules,
salary parsing (USD-only, midpoints), the token title-matcher, week
bucketing, and what is deliberately not normalized (locations,
multi-location duplicates, feed date caveats).

#### Scenario: Reader checks method
- **WHEN** a viewer expands the method notes
- **THEN** every derived field shown on the page is explained there
