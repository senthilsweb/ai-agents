# Tasks — jev-rules-gate

Owner prerequisites (not code):
- [x] TypeSafe subscription and API key (console.typesafe.ai/keys)
- [ ] Review TypeSafe Privacy Policy and Data Processing Agreement
- [x] `gh secret set TYPESAFE_API_KEY`
- [x] Approve this proposal (`PROPOSED` → `APPROVED`)

Implementation (after approval):
- [x] `pipeline/jev.py`: client, request whitelist, backoff on 429/529, usage logging
- [x] `config.yaml`: `jev` block (mode, model, thresholds, near-miss margin, question text)
- [x] Questions built from job-scout `targets` (single source), not duplicated
- [x] `filters.py`: Jev decides location and role fit when enabled; deterministic
      prefilters first; fallback to current rules on error or low confidence
- [x] `resumes.py`: Jev `choice` for the variant; fallback to `resumes.rules`
- [x] `graph.py` / `state.py`: gate results and shadow disagreements in state
- [x] `digest.py` + template: "Gate" section (counts, near-misses, shadow diffs)
- [x] `.github/workflows/job-pilot.yml`: pass `TYPESAFE_API_KEY` and `JEV_MODE`
- [x] Tests with a fake Jev: modes, thresholds, fallback, no-key = off, request
      whitelist (no resume text), key never logged
- [x] Docs: configuration, runbook, `.env.example`, root AGENTS.md
- [ ] Full test suite green; commit + push

Rollout:
- [ ] `JEV_MODE=shadow` for at least 14 daily runs
- [ ] Review the shadow report: recall guard (criterion 2), cost, latency, limits
- [ ] Set thresholds and the analyze-call reduction target from the data
- [ ] Pin the model version; switch to `enforce`
- [ ] Phase 2 decision (job-text hard constraints)
