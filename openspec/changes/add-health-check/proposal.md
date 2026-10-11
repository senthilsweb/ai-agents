# add-health-check

**Status:** implemented (unverified until first scheduled run)

## Why
2026-10-10: job-pilot's digest run was green but matched nothing — the home-lab
job-matcher endpoints returned 502 and the matcher's one-attempt-no-retry design
logs and moves on. Nothing alerted. We need an independent signal that the
hosted dependencies are up.

## What
`.github/workflows/job-pilot-health.yml` runs `.github/scripts/health_check.py`
every 4 hours (and on dispatch):

- Checks: job-matcher API `/health`, job-matcher agent `/health`, Phoenix and
  OTLP collectors (reachable = any HTTP answer < 500), job-scout parquet (HEAD).
- Each check retried 3x, 10 s apart, so a blip is not an alert.
- Any check down -> HTML alert email (same palette/SMTP secrets as the digest)
  listing status and impact per endpoint, then exit 1 (red run).
- `force_email` dispatch input sends the report even when all is up (test).

## Constraints
- **Zero spend:** no `/analyze`, `/upload` or LLM call; no OpenAI key is used.
- **Public repo:** hosts come from existing secrets and are never printed; the
  email shows check labels only. No artifacts uploaded.
- stdlib only, runs on the bare runner — no Docker image or pip install.

## Known limits
- Emails repeat every 4 h while an endpoint stays down (no dedupe/state).
- Trace collectors are judged by reachability only, not authenticated export.
- The GitHub runner must be able to reach the home lab (it already does for the
  digest run, so any tunnel/ingress is public).
