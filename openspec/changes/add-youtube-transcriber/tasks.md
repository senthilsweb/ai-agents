# Tasks — `youtube-transcriber`

Ordered by ceremony. Construction tasks MUST NOT start before
`.openspec.yaml` reads `status: approved` (see AI-SDLC-TAILORING.md).

## Open questions for the Inception gate

Three were answered when the change was raised (2026-07-22):

1. **ASR engine** — **local `faster-whisper`**, not hosted Groq. Zero cost,
   fully offline, audio never leaves the machine. Cost accepted: ~5–10 min
   per 60-minute video on CPU (no Metal backend on macOS) versus ~15–30 s
   for the hosted path.
2. **Output** — `runs/<timestamp>-<video_id>/` with `transcript.json`,
   `transcript.md`, `transcript.srt`, `metrics.json`.
3. **Invocation** — CLI only. No CI, no schedule, no server.

**Sign-off (2026-07-23, repo owner, Inception gate):**

4. **Default model: `distil-large-v3` at `int8`, and the wait is
   accepted.** Accuracy is preferred over speed; Bolt 3 still measures
   and records the real number, but a slow result is not a trigger to
   downgrade the default. `ASR_MODEL` remains env-switchable for anyone
   who wants to trade.
5. **`runs/` gitignored — confirmed.** Owner's framing: the repo is
   public and third-party work must not be pushed to it. This agent is
   internal productivity automation only. Recorded as the second
   deliberate exception to the monorepo's "runs/ is committed"
   convention, after job-matcher's PII exception.
6. **No Docker in v1.** Local CLI only. The Dockerfile task is dropped
   from Bolt 5 rather than deferred-with-a-stub — nothing containerised
   ships with this change.

## Inception (Mob Elaboration)

- [x] Study prior art: job-pilot (`pipeline/state.py`, `graph.py`,
      telemetry degrade-to-warning, pytest-only eval story), ADR 0003
- [x] Confirm local prerequisites: `yt-dlp` and `ffmpeg` are **not**
      installed on the dev machine (verified 2026-07-22); Python 3.12.8 is
- [x] Draft proposal.md / design.md / tasks.md / four capability specs
- [x] Repo owner reviews open questions 4–6 above (Sign-off 2026-07-23)
- [x] **Inception gate**: `.openspec.yaml` → `status: approved`

## Construction

### Bolt 1 — scaffold + resolver (pure, no network)

- [x] `agents/youtube-transcriber/` scaffold: `pyproject.toml`,
      `pipeline/` package, `.env.example`, `.gitignore` (`runs/`,
      `.cache/`, `*.cookies.txt`)
- [x] `pipeline/state.py` (pydantic models), `pipeline/resolve.py`
      (ID regex, host allowlist, param stripping, duration cap)
- [x] Evals 1–2 (id-parsing incl. the seed link's `&t=&pp=` params and
      hostile inputs; duration cap) green

### Bolt 2 — audio acquisition

- [x] `pipeline/audio.py` — `yt-dlp` metadata + download, `ffmpeg`
      normalize, cache by video ID; argument lists only, never `shell=True`
- [x] Prerequisite check (ffmpeg / yt-dlp on PATH) with actionable message
- [x] Tenacity retry on download only; failures recorded, not raised
- [x] Evals 3–4 (cache branch, retry policy with mocked subprocess) green

### Bolt 3 — transcription

- [x] `pipeline/transcribe.py` — `faster-whisper` adapter, env-driven model
      config, VAD on, segments → pydantic `Segment` list
- [x] Eval 5 (stub segment iterator → segment integrity) green
- [x] **Measure**: real timing on both seed videos; design.md's ASR table
      amended with the measured realtime factor (~4.8x). Recording only —
      per the gate, the default model is unchanged.

**Correction 1 (2026-07-23, Construction):** the measurement exposed a
defect in the instrumentation, not just a wrong estimate. `load_model()`
ran inside the timed transcribe node, so the first run of a machine's
life charged its one-time ~1GB weight download to transcription — making
the same video look 2.4x slower than a second video on the same machine
(RTF 1.94 vs 4.68). Fixed: `transcribe.py` times model load and ASR
separately; `outputs.py` computes `realtime_factor` from `asr_s`, falling
back to node time only when absent. Warm re-run confirmed:
`model_load_s` 267s -> 1.91s, `asr_s` steady at 180.7s, RTF 4.91,
byte-identical output. design.md's ASR table amended with the full
three-run table.

### Bolt 4 — outputs + graph + telemetry

- [x] `pipeline/outputs.py` — json / md / srt / metrics writers
- [x] `pipeline/graph.py` — `StateGraph` with the cache conditional edge;
      `run.py` CLI (N videos, per-video failure isolation, exit code)
- [x] `pipeline/telemetry.py` — LangSmith + OTel dual export,
      degrade-to-warning
- [x] Timestamped log file per invocation; no transcript text in logs
- [x] Evals 6–8 (outputs incl. SRT formatting and hostile title, graph
      wiring both branches, multi-video partial failure) green

### Bolt 5 — docs + security pass

- [x] Security-baseline pass over design.md §Security, all 8 items
      (2026-07-23):
      (1) **Subprocess injection** — `ytdlp._base_args`/`download_audio`
      and `audio.normalize` build argument **lists**; no `shell=True`
      anywhere in the package; the only interpolated user value is the
      validated id, reached via `VideoRef.canonical_url`. Covered by
      `test_commands_are_argument_lists_carrying_only_the_canonical_url`.
      (2) **Path traversal** — `audio.cache_path` and
      `outputs.run_dir_name` use the id + timestamp only; titles are
      data. Covered by
      `test_a_hostile_title_cannot_escape_the_runs_directory`.
      (3) **SSRF** — `resolve.ALLOWED_HOSTS`; 16 hostile-input cases in
      `test_resolve.py`, incl. the `youtube.com.evil.example.com`
      suffix trick and `file://`.
      (4) **Caps** — `ensure_within_duration` runs pre-download;
      `--max-filesize` always present in the download argv (asserted).
      A `yt-dlp` exit-0-with-no-file (the cap aborting mid-download) is
      treated as a failure, not a silent success.
      (5) **Copyright** — `runs/`, `.cache/`, `logs/` gitignored;
      README states the personal-use framing.
      (6) **Cookies** — `YT_COOKIES_FILE` env only, passed only when
      set (asserted); `*.cookies.txt` and `cookies.txt` gitignored.
      (7) **Secrets** — none exist on the local ASR path; no API key is
      required to run the agent.
      (8) **Prompt injection** — not applicable, there is no prompt.
      No unresolved gaps. One hardening added during the pass: the
      ffmpeg transcode writes to a temp sibling and `replace()`s into
      the cache, so a crash cannot leave a truncated file that the next
      run mistakes for a cache hit (covered by
      `test_an_empty_cache_file_is_not_a_hit`).
- [x] `agents/youtube-transcriber/README.md` — plain-English run guide,
      including the ffmpeg install step and the first-run weight download
- [x] Root `AGENTS.md` gains a youtube-transcriber section
- [x] Cross-artifact consistency pass: measured timings propagated into
      design.md (ASR table + Correction 1) and README; telemetry
      dual-export contract propagated into design.md §Observability,
      `.env.example`, and root AGENTS.md

## Verification (live)

- [x] End-to-end run on `EQuCyrwyfXU` (2026-07-23): 888s audio, 153
      segments, 2521 words; all four artifacts written
- [x] End-to-end run on `gYAqupu6iNI` (2026-07-23): 1092s audio, 219
      segments, 2550 words; all four artifacts written
- [x] Warm re-run of `EQuCyrwyfXU` -> cache hit logged, no download, and
      byte-identical output (153 segments / 2521 words). Also the first
      run with telemetry active: "LangSmith tracing enabled (project
      youtube-transcriber)" + "exporting spans to 2 endpoint(s)"
      (OpenObserve + Arize). Secrets copied from job-pilot's .env with
      LANGSMITH_PROJECT repointed.
- [x] Both videos in a single invocation -> two independent run folders,
      exit code 0
- [x] `git status` verified: `runs/`, `.cache/`, `logs/`, `.env` all
      report as ignored; `git ls-files` on the agent returns nothing for
      any of them
- [x] 83 pytest tests green (no network, no model, no secrets)
- [x] **Owner accuracy check passed (2026-07-23):** owner reviewed the
      output of three further videos (`eBUyTS7SzV4`, `qcNV1ItEkds`, plus a
      same-invocation repeat of `eBUyTS7SzV4`) and confirmed the transcript
      quality. That repeat also proved determinism — byte-identical SRT and
      Markdown on a 21-minute video, `diff` clean.
- [x] AI-DLC parity gaps closed (2026-07-23):
      `ai-dlc-in-practice/youtube-transcriber/ceremonies-and-roles.md`
      written (was missing while job-matcher, job-pilot and pii-classifier
      all had one), and `openspec/observations/0002-transcriber-realtime-
      factor-measurement.md` records the timing defect as the first
      Operations-phase artifact for this agent.
- [ ] **Owner action, last item before `status: verified`:** confirm the
      spans are visible in the LangSmith and Arize UIs. The agent side is
      confirmed ("exporting spans to 2 endpoint(s)"), but nobody has yet
      looked at either UI to see them land — an exporter reporting success
      is not the same as a span arriving.

## Process drift noted (not a task)

The code was committed as `2e68f95` and tagged `youtube-transcriber/v0.1.0`
(tag pushed to origin) while `.openspec.yaml` read `status: implemented`.
The lifecycle puts `verified` before a release cut, so the tag front-ran
its gate. Harmless here — a local CLI with no users — but recorded rather
than tidied away, per this repo's convention of logging decisions next to
the artifact they affected.
