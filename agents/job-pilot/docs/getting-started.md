# Getting Started

At the end you will have run job-pilot on your machine — first free,
then with real scoring — and know what each run costs.

## Path 1 — see the data it works on (5 minutes, nothing to install)

job-pilot's input is public. Open the
[trends dashboard](https://senthilsweb.github.io/ai-agents/trends/) or
query the parquet straight from any DuckDB shell:

```sql
SELECT count(*) FROM 'https://raw.githubusercontent.com/senthilsweb/ai-agents/main/agents/job-scout/data/ats_raw_trends.parquet';
```

## Path 2 — run the tests (5 minutes, no secrets)

```bash
cd agents/job-pilot
python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
.venv/bin/pytest -q          # 42 tests, no network, no cost
```

## Path 3 — a real run (needs secrets, small LLM cost)

1. Copy `.env.example` to `.env` and fill it — see
   [Configuration](configuration.md) for every value.
2. Set `RUN_PAID_MATCH=1` in `.env`. This is the paid-call switch: the
   pipeline refuses to call the matcher API without it.
3. Dry run first. It does everything — real job delta, real scoring,
   real PDFs — except sending the email:

    ```bash
    .venv/bin/python run.py --dry-run --baseline trends/20260714
    ```

    Open `runs/<date>/digest.html` and the PDFs next to it.

4. Full run. Drop `--dry-run` and the digest arrives by email.

`--baseline` names the dated snapshot to compare against (a
`trends/YYYYMMDD` git tag). Without it, the run uses yesterday's tag —
in CI, the tag of the last successful run.

Cost note: a typical day has 3–10 new matching jobs; each costs one
matcher API analysis. If the delta looks wrong (more than
`max_jobs_per_run` jobs), matching is skipped for that run — zero paid
calls, reported in the digest's Failures box — and the rest of the run
(including the email) completes normally.

Next: [Configuration](configuration.md)
