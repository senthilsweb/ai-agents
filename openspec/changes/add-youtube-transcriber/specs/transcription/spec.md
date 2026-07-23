# Spec: transcription

## ADDED Requirements

### Requirement: Transcription is local and consumes no LLM tokens
Transcription SHALL run locally via `faster-whisper`. The agent SHALL NOT
depend on any LLM client library, SHALL NOT make any model API call, and
SHALL NOT require an API key to produce a transcript. Audio SHALL NOT leave
the machine.

#### Scenario: Fully offline run
- **WHEN** cached audio exists and no API keys are set in the environment
- **THEN** a complete transcript is produced and the run's LLM token spend is zero

### Requirement: Transcription is of the audio, not the captions
The transcript SHALL be produced from the downloaded audio track. The agent
SHALL NOT fetch, fall back to, or merge YouTube's automatic or uploaded
caption tracks, and SHALL NOT substitute title or description text.

#### Scenario: Video with auto-captions available
- **WHEN** the video has auto-captions
- **THEN** they are ignored entirely and the transcript still comes from ASR over the audio

#### Scenario: Video with captions disabled
- **WHEN** the video has no caption track at all
- **THEN** the run succeeds unchanged, because captions were never a dependency

### Requirement: ASR behaviour is configured by environment, not code
`ASR_MODEL` (default `distil-large-v3`), `ASR_COMPUTE_TYPE` (default
`int8`), `ASR_LANGUAGE` (default auto-detect), and `ASR_BEAM_SIZE` SHALL be
read from the environment. Voice-activity detection SHALL be enabled by
default to skip silence and suppress hallucinated text in silent passages.

#### Scenario: Switching models
- **WHEN** the owner sets `ASR_MODEL=small.en` to trade accuracy for speed
- **THEN** the change takes effect with no code edit, and `metrics.json` records which model ran

### Requirement: Output is timestamped segments
Transcription SHALL yield an ordered list of segments, each with a
0-based index, `start_s`, `end_s`, and text, with monotonically
non-decreasing start times. The joined segment text SHALL form the full
transcript.

#### Scenario: Segment integrity
- **WHEN** the model returns segments
- **THEN** indices are contiguous from 0, every `end_s` is greater than or equal to its `start_s`, and no segment start precedes the previous segment's start
