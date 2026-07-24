# youtube-transcriber — AI-DLC ceremonies and roles

The running record of how `agents/youtube-transcriber/` moves through
Inception → Construction → Operations. Updated at every gate, same
discipline as [job-pilot](../job-pilot/ceremonies-and-roles.md) and
[job-matcher](../job-matcher/ceremonies-and-roles.md). Process contract:
`AI-SDLC-TAILORING.md`; change artifacts:
`openspec/changes/add-youtube-transcriber/`.

## Roles

- **Repo owner / product owner**: @senthilsweb — sets intent, answers
  gate questions, approves each phase.
- **AI pair**: Claude Code — drafts artifacts, builds under the gates,
  logs corrections where they happen.

## 1. Inception (Mob Elaboration) — 2026-07-22

**Intent (owner's words, condensed):** for a given YouTube video id or
link, get the whole audio and generate a transcript — "not the captions
or title but the full transcript". It should be fast and consume few
tokens. Use pydantic and whichever of LangGraph or LangChain is simpler
for the task.

**Elaboration findings that shaped the design:**

- The framing question — "less token consumption" — has an absolute
  answer rather than an optimization: transcription is **ASR, not text
  generation**. There is no reasoning step, so there is no prompt and no
  completion. Run locally, the agent's LLM token spend is exactly zero.
  This became the organizing constraint of the whole design, and is
  asserted by tests rather than assumed (no model client is imported;
  a transcript is produced with no API key set).
- LangGraph over LangChain was not a judgment call — ADR 0003 already
  pins it for Python orchestration agents in this repo. No new ADR was
  written; the existing one was reused.
- The pipeline is four deterministic steps, so the eval story is plain
  pytest, exactly as job-pilot established for an agent with no LLM
  reasoning of its own.
- One conditional edge was justified rather than assumed: re-transcribing
  an already-downloaded video with a different model is the normal
  iteration loop, so an audio cache keyed by video id earns the branch
  ADR 0003 §3 requires be justified.
- Untrusted input has exactly one boundary. The owner's own seed link
  carried `&t=19s&pp=ygUU…`; tracking parameters reaching a subprocess
  argument or a filesystem path is the kind of thing that looks harmless
  until it isn't, so the resolver strips everything but the 11-character
  id and that id is the only user-derived value allowed downstream.
- Three decisions were taken when the change was raised: local
  `faster-whisper` over hosted Groq; `runs/<timestamp>-<video_id>/` with
  four artifacts; CLI-only invocation.

**Gate approved 2026-07-23.** Owner's three answers, recorded in the
tasks.md Sign-off: default model stays **`distil-large-v3` at `int8`
and the wait is accepted** — accuracy over speed, so a slow measurement
is recorded but does not downgrade the default; **`runs/` gitignored,
confirmed** — "the repo is public and third-party work should not be
pushed, this is only for internal productivity automation", logged as
the second deliberate exception to the monorepo's runs-are-committed
convention after job-matcher's PII exception; and **no Docker in v1**,
so the drafted Dockerfile task was dropped from Bolt 5 rather than
deferred with a stub.

**Process note worth recording.** This change reached
`status: approved` *before* its tasks.md checklist began filling in.
That is the ordering `AI-SDLC-TAILORING.md` documents as having failed
for `add-privacy-classifier`, where Construction ran to completion while
`.openspec.yaml` still read `proposed`. The gate held here.

## 2. Construction — 2026-07-23 (day after the gate)

Five bolts, each with its evals green before the next started.

| Bolt | Content | Result |
|---|---|---|
| 1 | scaffold, pydantic state, resolver | 32 tests |
| 2 | yt-dlp + ffmpeg, audio cache, retry policy | 43 tests |
| 3 | faster-whisper adapter | 52 tests |
| 4 | outputs, StateGraph, telemetry, CLI | 73 tests |
| 5 | security pass, docs | 83 tests |

**Correction 1 (measurement defect, not just a wrong estimate).** The
drafted design flagged the realtime factor as "the single number most
likely to be wrong", which is why measuring it was a task rather than an
assumption. It was wrong — but the interesting part is *why*. The first
two videos measured 1.94x and 4.68x on the same machine with the same
model, a 2.4x spread that had nothing to do with transcription:
`load_model()` sat inside the timed transcribe node, so the first run of
a machine's life charged its one-time ~1 GB weight download to ASR. The
fix was to the instrumentation, not the documentation — model load and
ASR are now timed separately and `realtime_factor` is computed from ASR
alone. A warm re-run isolated it exactly: `model_load_s` fell from ~267 s
to 1.91 s while `asr_s` held at 180.7 s. Full detail in
`openspec/observations/0002-transcriber-realtime-factor-measurement.md`.

**Owner intervention during Construction.** Two questions mid-build —
what the 1 GB download was, and a request to wire LangSmith and Arize
with the keys used by the other agents. The second exposed that the
drafted `telemetry.py` was thinner than job-pilot's: single endpoint, no
Arize, and missing the `model_id` resource attribute whose absence made
Arize AX return 500s in job-pilot on 2026-07-15. Rewritten against the
established contract rather than reinvented, so a defect already paid
for once was inherited rather than rediscovered.

**Security baseline** passed over all 8 items in design.md with test
references for each. One hardening was added during the pass: the ffmpeg
transcode writes to a temp sibling and atomically replaces into the
cache, so a crash cannot leave a truncated file that the next run
mistakes for a cache hit.

## 3. Verification — 2026-07-23

Live e2e on the two owner-supplied seed videos, then three more at the
owner's request. Six transcripts, no failures, zero token spend.

- Both seed videos in one invocation, exit 0.
- Cache branch verified twice, including a same-invocation duplicate:
  the repeat skipped the download and produced **byte-identical** output
  on a 21-minute video (`diff` clean on both SRT and Markdown), which is
  determinism confirmed rather than merely speed.
- Telemetry confirmed active: LangSmith on its own project plus OTel
  dual export to OpenObserve and Arize.
- Measured realtime factor across five runs: 4.55–4.93, averaging
  ~4.75x. A 60-minute video takes ~12 minutes.
- `git` verified: `runs/`, `.cache/`, `logs/`, `.env` all ignored and
  untracked. The commit that shipped this (29 files) contains no
  transcript, no audio, and no secret.
- **Owner accuracy check passed** — the owner reviewed the output of
  three further videos and confirmed the transcript quality.

**Open at the time of writing:** traces have been confirmed exporting
from the agent side, but nobody has yet eyeballed the LangSmith and
Arize UIs to see them land. `status: verified` waits on that.

**Process drift to note:** the code was committed and tagged
`youtube-transcriber/v0.1.0` while `.openspec.yaml` read
`status: implemented`. The lifecycle puts `verified` before a release
cut, so the tag front-ran its gate. Harmless here — nothing shipped to
users — but it is exactly the sort of ordering slip this document
exists to make visible rather than tidy away.

## 4. Operations

Not started. The agent is a local CLI run by one person on demand; there
is no schedule, no CI, no server, and no container (all gate decisions).
`openspec/observations/0002` is the first Operations-phase artifact.
