# Tasks — docs-monorepo-job-pilot

- [x] Root `mkdocs.yml` → umbrella (monorepo + redirects plugins),
      root `docs/index.md` landing page. Found during build: the root
      `docs/` dir already existed — `ARCHITECTURE.md` added to nav;
      `openobserve-claude-code-query-cookbook.md` is marked "Internal
      reference" in its own header, so it is `exclude_docs`-ed from the
      public site rather than silently published.
- [x] `agents/job-scout/mkdocs.yml` child (nav unchanged;
      `extra_javascript` path re-pointed to `/job-scout/javascripts/`)
- [x] `agents/job-pilot/docs/` — index, getting-started,
      configuration, runbook, ci-cd, faq (style-guide standard set)
      + `agents/job-pilot/mkdocs.yml` child
- [x] Workflow: plugin installs + job-pilot doc paths
- [x] Local `mkdocs build --strict` green 2026-07-15 (live-page links
      made absolute — /trends/ and /console/ are post-build artifacts
      the link checker cannot see)
- [x] Redirect spot-check: built `/getting-started/` redirects to
      `../job-scout/getting-started/`
- [ ] Publish = commit + push to main (owner)
