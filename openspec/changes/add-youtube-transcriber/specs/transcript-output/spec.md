# Spec: transcript-output

## ADDED Requirements

### Requirement: One run folder per video, with four artifacts
Each video SHALL produce `runs/<UTC-timestamp>-<video_id>/` containing
`transcript.json` (video metadata, detected language, model used, and the
full segment list), `transcript.md` (the readable full transcript),
`transcript.srt` (subtitles), and `metrics.json` (per-stage wall-clock
timings, audio duration, and realtime factor).

#### Scenario: Two videos in one invocation
- **WHEN** two video IDs are passed on one command line
- **THEN** two independent run folders are created, and no combined output file is written

### Requirement: Run paths are built only from validated identifiers
Run directory and cache file names SHALL be derived from the validated
11-character video ID and a timestamp. Video titles, channel names, and any
other metadata SHALL NOT be used as path components.

#### Scenario: Hostile title
- **WHEN** a video's title contains slashes, `..`, or shell metacharacters
- **THEN** the run directory name is unaffected, the title appears only as data inside `transcript.json` and `transcript.md`, and nothing is written outside `runs/`

### Requirement: SRT output is valid
`transcript.srt` SHALL use 1-indexed cue numbers, `HH:MM:SS,mmm --> HH:MM:SS,mmm`
timing lines, and a blank line between cues.

#### Scenario: Timestamp formatting
- **WHEN** a segment runs from 3661.5 s to 3665.25 s
- **THEN** its timing line reads `01:01:01,500 --> 01:01:05,250`

### Requirement: Transcripts stay out of the public repo
`agents/youtube-transcriber/runs/` and `.cache/` SHALL be gitignored. This
is a deliberate exception to the monorepo's "runs/ is committed" convention,
because transcripts are verbatim third-party copyrighted speech and this
repository is public. Log files SHALL record video IDs, durations, and error
reasons only — never transcript text.

#### Scenario: After a successful run
- **WHEN** a transcript has been written
- **THEN** `git status` reports no new tracked files, and the run log contains no transcript content
