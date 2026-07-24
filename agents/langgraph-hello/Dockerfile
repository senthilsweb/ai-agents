# langgraph-hello — tiny REST image (agent-root Dockerfile, repo convention).
# No ffmpeg, no model weights, no secrets — so it builds small and boots fast,
# which is exactly what makes it a good Firecracker microVM smoke test.
#
#   cd agents/langgraph-hello
#   docker build -t langgraph-hello .
#   docker run -p 8000:8000 langgraph-hello
FROM python:3.12-slim

WORKDIR /app

COPY pyproject.toml ./
COPY pipeline ./pipeline
COPY server ./server

RUN pip install --no-cache-dir .

EXPOSE 8000
CMD ["uvicorn", "server.app:app", "--host", "0.0.0.0", "--port", "8000"]
