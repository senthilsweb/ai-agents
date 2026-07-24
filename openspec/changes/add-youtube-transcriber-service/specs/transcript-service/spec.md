# Spec: transcript-service

## ADDED Requirements

### Requirement: The service exposes the pipeline over HTTP without changing it
A FastAPI service SHALL expose the existing transcription pipeline over HTTP.
It SHALL import and call `pipeline.graph.run_one`, `pipeline.config.Config`,
`pipeline.resolve.parse_video_ref`, and `pipeline.transcribe.load_model`
without modifying `pipeline/`. The zero-LLM, zero-token, local-ASR property
SHALL be preserved: the service adds no model reasoning, no prompt, and no
API key.

#### Scenario: Pipeline unchanged
- **WHEN** the service processes a video
- **THEN** it invokes `run_one` and writes the same four artifacts
  (`transcript.json`, `.md`, `.srt`, `metrics.json`) the CLI writes, with no
  change to the pipeline code

### Requirement: The model is loaded once and held resident
On startup the service SHALL load the ASR model once (via
`transcribe.load_model`) so that a request does not pay the model load. It
SHALL also verify `ffmpeg` and `yt-dlp` are available at startup and fail fast
with an actionable message if either is missing.

#### Scenario: Warm model across requests
- **WHEN** the service has started and two transcription requests arrive
- **THEN** the model is loaded exactly once, before the first request is
  served, and neither request triggers a model load

#### Scenario: Missing prerequisite at startup
- **WHEN** `ffmpeg` is not on `PATH` when the service starts
- **THEN** startup fails with a message naming the fix, before any request is
  accepted

### Requirement: Transcription requests are asynchronous jobs
Because transcription is CPU-bound and can take minutes, `POST /transcribe`
SHALL enqueue a job and return a job id immediately rather than blocking.
Transcription work SHALL run off the event loop. Callers SHALL retrieve status
and results by polling `GET /jobs/{id}`.

#### Scenario: Long transcription does not block
- **WHEN** a caller posts a 60-minute video
- **THEN** the response returns promptly with a job id and status `queued`, and
  the event loop remains able to answer status polls while the job runs

#### Scenario: Job lifecycle
- **WHEN** a caller polls `GET /jobs/{id}` over the life of a job
- **THEN** the status progresses `queued` → `running` → `done` (or `error`),
  and on `done` the response carries the run metrics and the artifact locations

### Requirement: Every request input passes the pipeline's validation boundary
Every user-supplied value that could reach a subprocess or a filesystem path
SHALL be validated through `resolve.parse_video_ref` before it reaches
`run_one`. Input that is not a valid YouTube video id or an allowlisted-host
URL SHALL be rejected with a client error and SHALL NOT start a job.

#### Scenario: Malformed input rejected
- **WHEN** a caller posts a value that is not a valid video id or allowed URL
- **THEN** the service returns a 4xx error, no job is created, and no
  subprocess is spawned

### Requirement: Transcripts stay private to the caller and the VM
The service SHALL return a transcript only to the caller that requested it and
SHALL NOT commit, publish, or otherwise expose transcripts. Run outputs SHALL
remain inside the deployment (the microVM's `runs/`), consistent with the
`runs/` gitignore and the copyright framing of the original change.

#### Scenario: No transcript leaves the deployment
- **WHEN** a job completes
- **THEN** its artifacts are written to `runs/` inside the VM and are served
  only over the job's own artifact endpoints, never committed or pushed

### Requirement: The job registry is in-memory for v1
The job registry MAY be in-memory. A restart SHALL lose job history but SHALL
NOT lose any transcript already written to disk. This limitation SHALL be
documented.

#### Scenario: Restart preserves written transcripts
- **WHEN** the service restarts after a job has completed and written its
  artifacts
- **THEN** the artifact files remain on disk in `runs/`, even though the job is
  no longer listed by `GET /jobs/{id}`

### Requirement: The service is deployable as a Firecracker microVM via generic tooling
The service SHALL be packaged as a container image (agent-root `Dockerfile`,
same convention as other agents) with the ASR weights baked in so the microVM
boots with no weight download. Host provisioning SHALL use generic,
agent-agnostic tooling under `infra/firecracker/`, parameterized by image,
vCPUs, memory, and IP.

#### Scenario: Boot without downloading weights
- **WHEN** the container image is built and booted as a microVM rootfs
- **THEN** the service starts and loads the baked weights from local disk, with
  no network fetch of model weights

#### Scenario: Tooling is agent-agnostic
- **WHEN** a different agent's image is passed to the `infra/firecracker/`
  scripts
- **THEN** the scripts build a rootfs and boot a microVM for it without any
  transcriber-specific change
