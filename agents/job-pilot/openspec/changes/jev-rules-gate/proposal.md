# Proposal: jev-rules-gate — Jev decides the fuzzy rules and hard constraints

> Status: **APPROVED** (2026-10-11) and **implemented in `off`/`shadow`/`enforce` modes**; default `off`.
> Rollout: run `shadow` for 14 daily runs before enabling `enforce` (acceptance criterion 2).
> Owner: @senthilsweb.
> Builds on: `resume-variants` (implemented 2026-10-04), `us-location-filter`.
> Related: `propose-governed-agent-architecture` in the agent-job-matcher repo
> (its hard-constraint gate is the job-matcher-side counterpart; the question
> definitions here are meant to be reusable there).

## Why

job-pilot's rules are string heuristics, and they fail in both directions:

- **`filters.location_bucket`** is a hand-kept list of US states, cities and
  foreign place names. A string it doesn't recognise is `other` and is
  dropped before the paid call, so a good job in an unlisted city never
  reaches the matcher. On 2026-10-05, 148 of 308 new jobs were dropped by
  this gate alone.
- **`filters.is_candidate`** matches `title_keywords` as substrings, so
  "manager" style titles both over- and under-match.
- **`resumes.choose_variant`** (added 2026-10-04) is a title substring list.
  "Forward Deployed Engineering Manager" matches the manager rule first, and
  titles with no rule silently get the master.
- **Rejections are invisible.** The digest shows a count of jobs dropped,
  never which ones or how close they were, so a wrong rejection is never
  noticed.
- **Every new city or title is a code or config edit.**

These are fast, typed, bounded decisions — which is what TypeSafe's Jev is
built for. It is a "System One" model: you send a `state` and typed questions
(`choice`, `score`, `noul`) and get typed answers with probabilities and a
`confidence`, with no text generation. All questions in one call run in
parallel, so extra questions cost almost nothing. The owner is taking a Jev
subscription, stated to be about 20x cheaper per call than the LLM used
today (owner's figure — this change measures it rather than assuming it).

## What changes

- **`pipeline/jev.py`** — a thin client for `POST /v1/systemone`. One call per
  job carrying every question for that job. Reads `TYPESAFE_API_KEY`;
  records the response `model` and `usage` for every call.
- **Questions, phase 1 (job facts only — no job text, no resume).** State is
  the whitelisted `JobFact` fields: title, department, employment type,
  location, work mode, compensation summary.
  - `location` (`choice`): `us`, `remote_us`, `non_us`, `unclear`.
  - `target_role` (`noul`): the role is one of the owner's target families.
    The question text is built from job-scout's `targets` config, so the
    targets stay single-sourced.
  - `variant` (`choice`): `master`, `genai-fde`, `data-genai-fde`,
    `eng-manager`, with each variant's one-line description as its criteria.
- **What stays deterministic code:** the category set, the salary floor,
  `RUN_PAID_MATCH`, `max_jobs_per_run`, and every guard in the match runner.
  Jev replaces the fuzzy rules only.
- **Modes**, `JEV_MODE=off|shadow|enforce`, default `off`:
  - `off` — today's behaviour, byte for byte; no key means off.
  - `shadow` — Jev runs beside the current rules and changes nothing; the
    digest and log record every disagreement.
  - `enforce` — Jev decides location, role fit and variant.
- **Confidence-gated, with fallback.** Thresholds follow TypeSafe's own
  guidance (above ~0.9 act; 0.5–0.9 cautious; below 0.5 do not trust).
  In `enforce`, a low-confidence answer or any Jev error falls back to the
  existing rule for that job — a Jev outage can never block the digest.
  Initial thresholds are in `config.yaml` and are tuned from shadow data.
- **Rejections become visible.** The digest gains a "Gate" section: counts by
  reason, plus the near-misses (rejected with low confidence, or within a
  margin of the threshold), so a wrong rejection is seen the next morning.
- **Cost control.** Cheap deterministic prefilters (category, salary floor)
  run before Jev, so it sees only what could still qualify. Per-run Jev
  tokens are logged and compared with the analyze calls avoided.

## Phase 2 (separate approval, same change)

Hard constraints that need the job description — mandatory clearance or
credential, onsite mandate, stated minimum experience — as `noul` questions
(the governed-agent HC-06/07/08 set). Job text is harvested in memory during
the match step today, after the gate, so this needs the harvest to move
before the gate for the jobs that survive phase 1. Not part of the first
slice, and it sends job text, not only job facts, to Jev.

## Data handling

Only public job-posting facts go to Jev. The resume, cover letters and any
candidate identity never do; variant descriptions are generic one-liners. A
test asserts the request body contains only whitelisted fields. Phase 2 sends
public job text only. Before enabling, the owner reviews TypeSafe's Privacy
Policy and Data Processing Agreement (the docs reference a no-training
commitment and a DPA; the retention terms were not visible when this was
written). The API key lives only in the `TYPESAFE_API_KEY` GitHub secret.

## Out of scope

- **Cover letters, skill and evidence extraction, scoring.** Jev does not
  generate text, and the job-matcher's rule that no model produces a score
  stays. Jev as a shadow second opinion on the match band is a later idea.
- **The job-matcher's own gate** (other repo, other proposal).
- **Changing `title_keywords` or the salary floor values.**

## Open questions

1. **Model pinning:** the docs show `jev-latest` resolving to e.g. `jev-1.13.0`.
   Pin a version for reproducibility, or follow latest and log the resolved
   id? Proposed: follow latest in shadow, pin before `enforce`.
2. **Retry policy:** the docs ask for exponential backoff on 429/529, while
   the match runner is deliberately one-attempt-no-retry. Proposed: up to two
   retries on 429/529 only, then fall back.
3. **Limits are undocumented:** rate limits, latency and state size. Shadow
   mode measures them on a real 150–300 jobs per day.
4. **Phase 2 ordering:** harvest before the gate, and the effect on the
   existing single-attempt harvest rule.

## Acceptance criteria

1. With `JEV_MODE=off`, or no key, the digest and behaviour are identical to
   today's.
2. Over at least 14 daily shadow runs, no job that the current pipeline
   scored `good_match` or better is rejected by Jev at the `enforce`
   thresholds. This is the recall guard; a failure blocks `enforce`.
3. The shadow report shows, per question, agreement with the current rule and
   every disagreement with its confidence.
4. The reduction in `/analyze` calls per run is measured and the owner sets
   the target from that data; the 20x price claim is checked against the logged
   usage.
5. Any Jev error, timeout or 429/529 falls back to the existing rule, is
   recorded as a Failure, and never prevents the email.
6. Every gate rejection records the question, answer and confidence, and the
   digest lists the near-misses.
7. A test fails if a Jev request contains a field outside the whitelist or any
   resume text.
8. The key is read only from the environment and never logged or written to
   run output.

## Implementation notes (2026-10-11)

- API verified live: `POST https://api.typesafe.ai/v1/systemone`, `Authorization:
  Bearer <key>`, object `state` accepted, `jev-latest` resolved to `jev-1.13.0`.
  A `noul` answer has no `confidence` — the probability itself is used, and a
  `noul` is "sure" when `max(p, 1-p)` meets the threshold.
- First shadow run on the 2026-10-10 delta: 126 new, 83 asked after the
  deterministic prefilter, 0 errors, ~19 s sequential, ~49k input tokens
  (~$0.002 at the published $0.042/M). Rules and Jev agreed on all 4 candidates.
  Jev leaned "target" (p 0.63–0.81) for three manager/director roles the title
  rules drop — the first data point for the recall question.
- Near-miss was recalibrated: Jev confidence clusters near 1.0, so "below
  threshold + margin" flagged 66 of 79 rejects. It is now "rejected although
  Jev gave >= `near_miss_floor` (0.30) probability of passing".
- Added: a circuit breaker (`breaker_after`, 5 consecutive errors), per-run
  usage logging, a Jev reachability probe in the health check.
