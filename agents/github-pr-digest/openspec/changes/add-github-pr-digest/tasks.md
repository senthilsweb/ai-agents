# Tasks

## Shipped

- [x] Define request and normalized PR schemas
- [x] Implement per-role model configuration (env override + fallback)
- [x] Implement orchestrator instructions and request resolver
- [x] Implement Repository Scout subagent and GitHub REST tool
- [x] Implement deterministic report tool (`render_and_save_report`) — replaces the originally planned Digest Reporter LLM subagent
- [x] Implement report persistence tool
- [x] Add daily UTC schedule
- [x] Add setup documentation and environment template

## ADR 0001 / 0002 follow-up (Phase 1)

- [ ] Wire `#shared/*` and move model resolution into `shared/lib/model.ts` (delete inlined blocks; fill empty `agent/lib/`)
- [ ] Add shared usage hook + `read_usage`; emit `runs/<id>/summary.json` (tokens + cost)
- [ ] Replace per-tool `HOST_REPORT_ROOT` dual-writes with a single `sync_run_to_host`
- [ ] Make model resolution fully env-driven and remove the hard-coded model default; orchestrator = reasoning-class, scout = fast non-reasoning-class
- [ ] Add orchestrator step/turn ceiling + wall-clock budget guardrails
