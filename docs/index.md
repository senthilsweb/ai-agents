# ai-agents

A monorepo of small, spec-driven AI agents. Two of them publish their
wikis here; the rest are documented in the
[repository](https://github.com/senthilsweb/ai-agents).

## The agents on this site

- **[job-scout](job-scout/index.md)** — watches ~95 technology
  companies' own job boards, publishes a daily public parquet of open
  postings, and powers the live
  [trends dashboard](https://senthilsweb.github.io/ai-agents/trends/).
- **[job-pilot](job-pilot/index.md)** — runs after each daily publish:
  finds the new jobs that match the owner's target roles, scores them
  through the job-matcher API, and emails one digest with cover-letter
  PDFs attached.

## Live pages

- [Trends dashboard](https://senthilsweb.github.io/ai-agents/trends/) —
  daily hiring trends from the public dataset, rebuilt every morning.
- [DuckDB console](https://senthilsweb.github.io/ai-agents/console/) —
  query the public parquet in your browser.

## How these agents are built

Every non-trivial change goes through a written proposal, design,
tasks, and specs before construction (`openspec/` in the repo), with a
human approval gate between phases — the working method the
[Documentation Style Guide](job-scout/style-guide.md) and the AI-DLC
write-ups describe.
