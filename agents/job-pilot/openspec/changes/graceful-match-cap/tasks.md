# Tasks — graceful-match-cap

- [x] `pipeline/matcher.py`: cap check becomes a soft skip returning
      `([], [Failure(node="match_cap", ...)])` instead of raising;
      reads `MAX_JOBS_PER_RUN` env with `config.yaml` fallback;
      `RUN_PAID_MATCH` guard behavior unchanged (still hard-aborts)
- [x] `tests/test_matcher.py`: rewrite `test_cap_aborts_before_any_paid_call`
      → asserts soft-skip, zero harvest/analyze calls, one `match_cap`
      Failure; add env-override test
- [x] `.github/workflows/job-pilot.yml`: optional `max_jobs_per_run`
      dispatch input, `MAX_JOBS_PER_RUN` env passthrough
- [x] `.env.example` + `docs/configuration.md`: document the env
      override and the new skip-not-abort behavior
- [x] Full test suite green
- [x] Commit + push (rebuilds `ghcr.io/senthilsweb/job-pilot:latest` via
      `job-pilot-image.yml`)
- [ ] Owner confirms: next digest run (scheduled or dispatched) succeeds
      and clears the `trends/20260807` baseline deadlock (Verification)
