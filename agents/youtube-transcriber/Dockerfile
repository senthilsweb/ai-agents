# youtube-transcriber — REST service image (same convention as
# agents/job-pilot/Dockerfile). Build with the agent directory as context;
# unlike job-pilot this agent is self-contained and needs nothing from the
# rest of the monorepo:
#
#   cd agents/youtube-transcriber
#   docker build -t youtube-transcriber .
#   docker run -p 8000:8000 youtube-transcriber
#
# The ~1 GB distil-large-v3 (int8) weights are baked in at build time
# (gate-amendment decision 2026-07-24), so the container — and the Firecracker
# microVM rootfs built from it — boots with no weight download and no network
# dependency for the model. Image lands ~2.5 GB.
FROM python:3.12-slim

# ffmpeg is the one system dependency the pipeline shells out to (audio
# normalisation). yt-dlp arrives via pip as a project dependency.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml ./
COPY pipeline ./pipeline
COPY server ./server

RUN pip install --no-cache-dir .

# Bake the ASR weights into the image. faster-whisper caches to
# ~/.cache/huggingface; this download becomes an image layer, so first boot
# loads the model from local disk. Model + compute type match the pinned
# defaults in pipeline/config.py.
RUN python -c "from faster_whisper import WhisperModel; WhisperModel('distil-large-v3', device='cpu', compute_type='int8')"

# The weights are baked, so never phone home to HuggingFace at startup. Without
# this, the loader tries to validate the cached model over the network and, on
# a host with no DNS (e.g. a Firecracker microVM), crashes at startup with a
# name-resolution error instead of using the local cache. Set AFTER the bake so
# the download above still works at build time.
ENV HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1

# No secrets are baked. ASR is fully local — there is no API key. Optional
# telemetry (OTLP endpoint) arrives as an env var at `docker run` time.
EXPOSE 8000
CMD ["uvicorn", "server.app:app", "--host", "0.0.0.0", "--port", "8000"]
