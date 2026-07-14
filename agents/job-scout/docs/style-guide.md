# Documentation Style Guide

The writing standard for every senthilsweb repo (`ai-agents`,
`agent-job-matcher`, and future projects). It covers wiki pages,
READMEs, `AGENTS.md`, and `SKILL.md` files. Each repo publishes its own
independent docs site; this page is the one canonical copy of the
rules — other repos link here instead of copying it.

## Voice and language

- Plain English: short sentences, everyday words, no idioms. Readers
  include non-native speakers.
- Define a term where it first appears ("a *slug* is the short name in
  the job board's URL"), then use it freely.
- Name the audience when it changes ("for analysts", "for developers").
- State facts directly. Never soften a safety rule ("never commit
  secrets", not "you probably shouldn't commit secrets").

## Wiki pages

- Organize by **task**, not by module. The standard page set: Home,
  Getting Started, Installation, Configuration, one or two
  subject-deep pages (data, API, surfaces…), Runbook, FAQ & Design
  Decisions.
- Every task page opens with one sentence of the form *"At the end you
  will have/know …"*.
- Every page ends with a `Next:` link to the natural following page.
- Getting Started offers independent "5-minute paths" — each complete
  on its own, cheapest first, nothing to install if possible.
- The Runbook holds: what runs automatically (a table), any procedure
  with cost or risk (with its guard), and a failure → fix list where
  every entry is something that actually happened.
- FAQ answers are short and each links to the spec/ADR that recorded
  the full reasoning. Docs explain *how to use*; specs record *why
  built*. Never duplicate a spec into prose.

## README = front door

A README contains only: what the project is (a few sentences, one
diagram if it earns its place), an **"I want to… → run this"** table,
a Documentation section listing the wiki pages, and Layout. Everything
deeper is a one-line pointer into the wiki. If a topic has a wiki
page, the README must not also explain it.

## Commands and examples

- Every command is copy-pasteable exactly as shown, from the stated
  directory.
- Show expected output only when the reader needs it to confirm
  success — and only output that was actually produced. Never invent
  output, numbers, or filenames.
- Test every query/command while writing the page. If it cannot be
  run, do not print it.

## Links and anchors

- Between wiki pages: plain relative links (`configuration.md`).
- To anything outside `docs/` (code, config, workflows, other repos):
  absolute GitHub URLs, so links work from the published site too.
- Headings that are link targets use only plain words — no backticks,
  em-dashes, or dots — because GitHub and MkDocs generate different
  anchors for punctuation. Put identifiers in parentheses:
  `### Adding a company (search.ats_org_slugs_by_company)`.

## Safety facts repeat

A guard is documented where the reader acts, even if that repeats it:
paid operations name their cost and guard at every place they can be
started; "never commit secrets / personal files" appears in every page
that touches configuration.

## AGENTS.md

`AGENTS.md` is loaded by coding agents every session — it defines
behavior, it does not teach. Rules:

- Repo root holds the repo-wide conventions; a workspace adds its own
  (`backend/AGENTS.md`) rather than repeating the root.
- Short numbered rules, imperative mood, one enforceable requirement
  per rule, each with its *why* in one sentence.
- A layout tree with one-line annotations is welcome; tutorials,
  walkthroughs, and command cookbooks are not — those belong in the
  wiki, linked.
- Keep it stable and small: every line costs context in every agent
  session. Move anything that changes often into docs.

## SKILL.md

A skill is one reusable capability an agent can load on demand — one
folder per skill (`skills/<name>/` or `.agents/skills/<name>/`)
containing a `SKILL.md`:

- Frontmatter: `name` (kebab-case) and a one-line `description` — the
  description alone decides when the skill gets loaded, so it states
  *when to use it*, not what it is.
- Body: when to use / when not to, numbered steps in imperative mood,
  then references. Plain English, same as every other doc.
- Keep the body under ~150 lines; push detail into files the skill
  references.

## The site pattern

Each repo publishes independently to
`senthilsweb.github.io/<repo>/`: `docs/` + `mkdocs.yml` (Material
theme, explicit `nav`) + a Pages workflow that runs
`mkdocs build --strict` (broken links fail CI) with mkdocs pinned
`< 2`. Copy the setup from
[ai-agents](https://github.com/senthilsweb/ai-agents/blob/main/.github/workflows/job-scout-docs.yml)
— only `site_name`, `docs_dir`, and `nav` change.
