# Spec: audio-acquisition

## ADDED Requirements

### Requirement: Input is resolved to a validated YouTube video ID
The agent SHALL accept a bare 11-character video ID, a `watch?v=` URL, a
`youtu.be/` short link, or a `/live/` or `/shorts/` URL, and SHALL extract
the video ID with the regex `^[A-Za-z0-9_-]{11}$`. All other query
parameters SHALL be discarded. Any URL whose host is not `youtube.com`,
`www.youtube.com`, `m.youtube.com`, or `youtu.be` SHALL be rejected before
any subprocess runs.

#### Scenario: Link with tracking parameters
- **WHEN** the input is `https://www.youtube.com/watch?v=EQuCyrwyfXU&t=19s&pp=ygUUa2FydGhpayBrcmlzaG5hbXV0aHk%3D`
- **THEN** the resolved ID is `EQuCyrwyfXU` and neither `t` nor `pp` appears in any subprocess argument, cache filename, or run directory name

#### Scenario: Hostile input
- **WHEN** the input is a non-YouTube host, a path-traversal string, or contains shell metacharacters
- **THEN** the run is rejected with a clear error and no subprocess is invoked

### Requirement: Only the audio stream is downloaded, and only once
The agent SHALL download the audio stream alone (`yt-dlp -f bestaudio
--extract-audio`), never the video stream, and SHALL normalize it to 16 kHz
mono via ffmpeg. The normalized file SHALL be cached at
`.cache/audio/<video_id>.opus`. When that file already exists, the fetch and
normalize steps SHALL be skipped.

#### Scenario: First run
- **WHEN** no cached audio exists for the video
- **THEN** audio is downloaded, normalized, cached, and `cache_hit` is false

#### Scenario: Re-run with a different model
- **WHEN** cached audio exists and the run is repeated with a different `ASR_MODEL`
- **THEN** no network call is made, `cache_hit` is true, and transcription runs against the cached file

### Requirement: Download is retried; transcription is not
Audio download SHALL be retried up to 3 times with exponential backoff,
because the call is free and idempotent. Transcription SHALL NOT be retried.

#### Scenario: Transient network failure
- **WHEN** the first two download attempts fail and the third succeeds
- **THEN** exactly 3 attempts are made and the run continues normally

#### Scenario: Persistent failure
- **WHEN** all 3 attempts fail
- **THEN** the failure is logged and recorded on the video's state, and no exception escapes the run

### Requirement: Oversized videos are rejected before download
Video duration SHALL be read from metadata before any audio is fetched, and
a video longer than `MAX_DURATION_MIN` (default 180) SHALL be rejected.
`yt-dlp --max-filesize` SHALL additionally bound the download.

#### Scenario: Four-hour stream
- **WHEN** metadata reports a duration of 240 minutes and the cap is 180
- **THEN** the video is rejected before any audio is downloaded
