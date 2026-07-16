# Tasks — us-location-filter

- [x] `location_bucket()` in `pipeline/filters.py` + `us_only` gate in
      `is_candidate`; `filter.us_only: true` in config.yaml
- [x] Golden tests per bucket + gate on/off; full suite green
      (59 passed, 2026-07-15)
- [x] Real-data check on today's delta: 5 → 3 candidates; both drops
      verified correct against the parquet (Harvey PM = Sydney,
      Coder PM = United Kingdom); 62 of 123 new jobs location-dropped
- [x] Docs: configuration page row
- [ ] Commit + push so tomorrow's scheduled digest uses the gate
