# Spec: run-orchestration

## ADDED Requirements

### Requirement: The pipeline is a LangGraph StateGraph
The pipeline SHALL be a LangGraph `StateGraph` with nodes `resolve_video`,
`fetch_audio`, `normalize_audio`, `transcribe`, `write_outputs`, and one
conditional edge that skips fetch and normalize when cached audio exists.
State SHALL be pydantic models. LangChain chain and agent abstractions
SHALL NOT be used, and `langchain-core` SHALL NOT be imported directly
(ADR 0003).

#### Scenario: Cold run
- **WHEN** no cached audio exists
- **THEN** nodes execute in the order resolve → fetch → normalize → transcribe → write

#### Scenario: Warm run
- **WHEN** cached audio exists
- **THEN** the graph goes resolve → transcribe → write, and fetch and normalize do not execute

### Requirement: The CLI accepts one or more videos and isolates their failures
`run.py` SHALL accept one or more video IDs or URLs and run the graph once
per video, sequentially. A failure on one video SHALL be logged and recorded
without stopping the others. The process SHALL exit non-zero if any video
failed.

#### Scenario: Partial failure
- **WHEN** two videos are requested and the first fails to download
- **THEN** the second is still transcribed and written, the failure is reported in the summary, and the exit code is non-zero

### Requirement: Telemetry degrades to a warning
LangSmith and OTel export SHALL be configured from environment variables
only. Missing, misconfigured, or unreachable telemetry backends SHALL
produce a logged warning and SHALL NOT prevent a transcript being written.

#### Scenario: No telemetry configured
- **WHEN** no telemetry environment variables are set
- **THEN** the run completes normally, writes all four artifacts, and logs one warning

### Requirement: Prerequisites fail fast with an actionable message
Missing `ffmpeg` or `yt-dlp` SHALL be detected at startup and reported with
the command needed to install it, before any video is processed.

#### Scenario: ffmpeg not installed
- **WHEN** `ffmpeg` is not on `PATH`
- **THEN** the run stops immediately with a message naming `brew install ffmpeg`, and no partial run folder is left behind
