# Observation 0002 — A first-run model download hid inside the transcription timer

- **Status**: Confirmed by an isolating re-run; fixed in code
- **Date**: 2026-07-23
- **Scope**: `agents/youtube-transcriber/pipeline/transcribe.py`,
  `pipeline/outputs.py`, `pipeline/graph.py`. The pattern generalizes to any
  agent whose node timing wraps a lazily-initialized resource.
- **Related**: `openspec/changes/add-youtube-transcriber/design.md`
  (§ASR engine, Correction 1), that change's `tasks.md` Bolt 3,
  `ai-dlc-in-practice/youtube-transcriber/ceremonies-and-roles.md`.

## Context

`youtube-transcriber` runs local ASR, so its wall-clock cost is the whole
of its cost — there is no token bill to talk about instead. The drafted
design named the realtime factor (audio seconds transcribed per wall-clock
second) as "the single number most likely to be wrong" and made measuring
it a Construction task rather than an assumption. That instinct was right,
but the first measurement was itself wrong, and the way it was wrong is
the point of this note.

## Finding 1 — The same machine reported a 2.4x spread on identical settings

Two videos, one invocation, same model (`distil-large-v3` at `int8`), same
CPU, same code path:

| Video | Audio | Node time | Reported RTF |
|---|---|---|---|
| `EQuCyrwyfXU` (first ever run) | 888 s | 457.5 s | 1.94 |
| `gYAqupu6iNI` (same process) | 1092 s | 234.2 s | 4.68 |

Nothing about the two videos explains a 2.4x difference. Both are ordinary
recorded talks in the same language at similar audio quality.

## Finding 2 — The cause was the timer's boundary, not the workload

`load_model()` was called *inside* the node that `graph.py` wraps in its
timing helper. On the first run of a machine's life that call downloads
roughly 1 GB of Whisper weights from HuggingFace. So the first video was
billed for a one-time network download as though it were transcription
work, and every subsequent video in the process — hitting the in-process
model cache — was not.

The failure mode is quiet in a specific and unhelpful way: the number is
never absurd. 1.94 is a plausible realtime factor for CPU ASR. Nothing
looks broken; the tool just appears two and a half times slower than it
is, and only on the measurement everyone takes first.

## Finding 3 — A warm re-run isolated it exactly

Re-running the same video with the audio already cached and the weights
already on disk:

| Metric | First run | Warm re-run |
|---|---|---|
| `model_load_s` | ~267 s (inferred) | **1.91 s** |
| `asr_s` | not separated | 180.7 s |
| Node time | 457.5 s | 182.6 s |
| RTF | 1.94 | **4.91** |

Output was byte-identical across the two runs (153 segments, 2521 words),
so the difference is entirely setup cost, not different work.

## Fix

Instrumentation, not documentation. `transcribe.py` now times model load
and ASR separately and records `model_load_s` and `asr_s` on the state;
`outputs.py` computes `realtime_factor` from `asr_s`, falling back to node
time only when absent (older runs, mocked paths). Two tests pin the
behaviour: `test_realtime_factor_excludes_model_load_time` and
`test_realtime_factor_falls_back_to_node_time`.

Honest figure after the fix, across five runs on four videos: **4.55–4.93,
averaging ~4.75x realtime**. A 60-minute video takes about 12 minutes. The
original drafted estimate of 5–10 minutes was closer to the truth than the
corrected-from-bad-data figure of ~31 minutes that briefly replaced it.

## Generalizable lesson

Wrapping a node in a timer measures the node, including whatever the node
lazily initializes the first time it runs. Any agent here that times a
step which loads a model, opens a pool, warms a cache, or fetches weights
will over-report that step on its first execution and under-report the
cost of everything else.

Two habits follow, both cheap:

1. **Time the resource acquisition separately from the work**, and derive
   any rate metric from the work alone.
2. **Distrust a first measurement that has no second measurement to argue
   with.** This defect was invisible with one video and obvious with two.
   The comparison, not the number, is what found it.

A corollary for this repo's existing agents: any per-node timing that
feeds a cost or throughput figure is worth a glance for the same boundary
problem, particularly where a model or client is constructed on first use.
