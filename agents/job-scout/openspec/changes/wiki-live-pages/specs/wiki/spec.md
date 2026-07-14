# Spec: wiki live pages (delta)

## Requirement: Hosted console
The published site SHALL serve the DuckDB browser console at
`/console/`, defaulting to a query against the public parquet.

#### Scenario: One-click exploration
- **WHEN** a visitor opens /console/ and presses Run
- **THEN** rows from the current public dataset render, with no
  credentials or install

## Requirement: Daily public dashboard, facts only
The site SHALL serve the trends dashboard at `/trends/`, rebuilt daily
in CI from the committed parquet, containing zero JD text and zero
embedded role keywords. The tracker SHALL render only from a
`?roles=` URL parameter and stay hidden otherwise.

#### Scenario: Copyright and privacy boundary
- **WHEN** the published /trends/ HTML is inspected
- **THEN** it contains no jd_text and no keyword list from config.yaml

#### Scenario: Owner's filter
- **WHEN** /trends/?roles=ai engineer,engineering manager is opened
- **THEN** the target tracker shows counts for exactly those two
  keywords

## Requirement: No repo growth
Live pages SHALL be produced inside the docs workflow after
`mkdocs build` and SHALL NOT be committed to git.

#### Scenario: Daily refresh
- **WHEN** the 11:45 UTC docs cron completes
- **THEN** /trends/ serves today's data and the repo has no new commit

## Requirement: Uniform markdown capabilities
Both repos' sites SHALL render mermaid fences, footnotes, collapsible
details, tabbed blocks, and click-sortable tables.

#### Scenario: Diagram parity
- **WHEN** a ```mermaid fence is used in either wiki
- **THEN** it renders as a diagram on GitHub and on the site
