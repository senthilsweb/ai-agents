"""cmg-orchestrator — the A2A layer of the ~/opt/cmg local deployment.

One prompt ("transcribe <any YouTube link> and add it to talk-value-stats")
drives a main agent that delegates to two subagents:

  transcriber  -> start_transcription / wait_for_job  (REST, $TRANSCRIBER_URL)
  stats        -> extract_stats / build_site          (one-shot docker run)

Transcripts move through the shared runs/ mount, never through the agents —
only ids and statuses cross the boundary. Publishing to Pages is deliberately
NOT a tool: the run ends by printing the git command for the human.

Spec: openspec/changes/add-cmg-local-deploy/specs/cmg-orchestration/spec.md
"""

from __future__ import annotations

import asyncio
import subprocess
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

import core

# Deployed config first (run.sh cwd-independent), then a local dev .env.
load_dotenv(Path.home() / "opt" / "cmg" / "orchestrator" / ".env")
load_dotenv(Path(__file__).resolve().parent / ".env")

from claude_agent_sdk import (  # noqa: E402  (import after dotenv by design)
    AgentDefinition,
    AssistantMessage,
    ClaudeAgentOptions,
    ResultMessage,
    TextBlock,
    create_sdk_mcp_server,
    query,
    tool,
)

SETTINGS: core.Settings | None = None  # resolved in main(), after env is loaded


def _ok(text: str) -> dict:
    return {"content": [{"type": "text", "text": text}]}


def _err(text: str) -> dict:
    return {"content": [{"type": "text", "text": text}], "is_error": True}


@tool(
    "start_transcription",
    "Submit a YouTube URL or 11-char video id to the local transcription "
    "service. Returns the job id to pass to wait_for_job.",
    {"url": str},
)
async def start_transcription(args: dict) -> dict:
    s = SETTINGS
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(f"{s.transcriber_url}/transcribe", json={"url": args["url"]})
    if resp.status_code >= 400:
        return _err(f"transcriber rejected the input ({resp.status_code}): {resp.text}")
    return _ok(resp.text)


@tool(
    "wait_for_job",
    "Block until the transcription job finishes (polls the service "
    "internally every 10s, up to 90 min). Returns the final job record "
    "including video_id and status done|error.",
    {"job_id": str},
)
async def wait_for_job(args: dict) -> dict:
    s = SETTINGS

    def get_job(job_id: str) -> dict:
        resp = httpx.get(f"{s.transcriber_url}/jobs/{job_id}", timeout=30)
        resp.raise_for_status()
        return resp.json()

    try:
        job = await asyncio.to_thread(core.poll_job, get_job, args["job_id"])
    except TimeoutError as exc:
        return _err(str(exc))
    text = str(job)
    return _ok(text) if job.get("status") == "done" else _err(text)


def _run(cmd: list[str], timeout: int) -> dict:
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    out = (proc.stdout + proc.stderr).strip()
    if proc.returncode != 0:
        return _err(f"exit {proc.returncode}:\n{out}")
    return _ok(out or "ok")


@tool(
    "extract_stats",
    "Run talk-value-stats extraction for a transcribed video: upserts the "
    "repo's db.json from the transcript found in the shared runs/ mount. "
    "Takes the 11-char YouTube video id only.",
    {"video_id": str},
)
async def extract_stats(args: dict) -> dict:
    try:
        cmd = core.extract_cmd(SETTINGS, args["video_id"])
    except ValueError as exc:
        return _err(str(exc))
    return await asyncio.to_thread(_run, cmd, 900)


@tool(
    "build_site",
    "Rebuild the talk-value-stats static site from the repo's db.json into "
    "the deployed dist/ directory. Takes no arguments.",
    {},
)
async def build_site(args: dict) -> dict:
    return await asyncio.to_thread(_run, core.build_site_cmd(SETTINGS), 300)


CMG_TOOLS = [
    "mcp__cmg__start_transcription",
    "mcp__cmg__wait_for_job",
    "mcp__cmg__extract_stats",
    "mcp__cmg__build_site",
]

MAIN_PROMPT = """You orchestrate a two-agent pipeline over locally deployed
agents. Given a prompt naming a YouTube video:
1. Delegate to the `transcriber` subagent to transcribe it; it reports the
   11-char video_id when done.
2. Delegate to the `stats` subagent with that video_id to extract stats and
   rebuild the site.
3. Report concisely: video id, transcription status, and what the stats
   extraction added. Do not attempt any git operation — publishing is done by
   the human afterwards."""


def build_options(s: core.Settings) -> "ClaudeAgentOptions":
    cmg = create_sdk_mcp_server(
        name="cmg",
        version="1.0.0",
        tools=[start_transcription, wait_for_job, extract_stats, build_site],
    )
    return ClaudeAgentOptions(
        model=s.model,
        system_prompt=MAIN_PROMPT,
        mcp_servers={"cmg": cmg},
        agents={
            "transcriber": AgentDefinition(
                description="Transcribes one YouTube video via the deployed "
                "local ASR service.",
                prompt="Call start_transcription with the video URL/id from "
                "your task, then wait_for_job with the returned job id. "
                "Report the video_id, final status, and word count. On "
                "error, report the error message verbatim.",
                tools=CMG_TOOLS[:2],
            ),
            "stats": AgentDefinition(
                description="Extracts talk-value stats for a transcribed "
                "video into db.json and rebuilds the static site.",
                prompt="Call extract_stats with the 11-char video id from "
                "your task, then build_site. Report what the extraction "
                "printed (title, counts) and confirm the site rebuilt.",
                tools=CMG_TOOLS[2:],
            ),
        },
        # Strict allowlist: delegation + the four cmg tools, nothing else.
        # "Agent" is the delegation tool in current SDKs; "Task" kept for
        # older versions — an unknown name in this list is inert.
        allowed_tools=["Agent", "Task", *CMG_TOOLS],
        disallowed_tools=["Bash", "Write", "Edit", "WebFetch", "WebSearch"],
        permission_mode="default",
    )


async def run(prompt: str) -> int:
    s = SETTINGS
    exit_code = 1
    async for message in query(prompt=prompt, options=build_options(s)):
        if isinstance(message, AssistantMessage):
            for block in message.content:
                if isinstance(block, TextBlock):
                    print(block.text, flush=True)
        elif isinstance(message, ResultMessage):
            exit_code = 0 if message.subtype == "success" else 1
            cost = getattr(message, "total_cost_usd", None)
            if cost is not None:
                print(f"\n[cmg] cost: ${cost:.4f}", flush=True)
    print(f"\n{core.publish_hint(s)}", flush=True)
    return exit_code


def main() -> None:
    if len(sys.argv) < 2 or not sys.argv[1].strip():
        print(
            'usage: cmg-orchestrator "transcribe <youtube-url-or-id> and add '
            'it to talk-value-stats"',
            file=sys.stderr,
        )
        raise SystemExit(2)
    global SETTINGS
    try:
        SETTINGS = core.Settings.from_env()
    except core.SettingsError as exc:
        print(f"config error: {exc}", file=sys.stderr)
        raise SystemExit(2)
    raise SystemExit(asyncio.run(run(" ".join(sys.argv[1:]))))


if __name__ == "__main__":
    main()
