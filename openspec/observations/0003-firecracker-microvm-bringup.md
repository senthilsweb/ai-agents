# Observation 0003 — Booting an agent as a Firecracker microVM: four things a container quietly provides

- **Status**: Confirmed by live bring-up on Intel bare metal; all four fixed in `infra/firecracker/`
- **Date**: 2026-07-24
- **Scope**: `infra/firecracker/*` (the generic microVM tooling),
  `agents/youtube-transcriber/Dockerfile`. The findings generalize to **any**
  agent booted as a Firecracker microVM from a `docker export`ed rootfs.
- **Related**: `openspec/changes/add-langgraph-hello/`,
  `openspec/changes/add-youtube-transcriber-service/`, infra commits
  `a5667df`, `062fc32`, `378f19e`, `f955b8f`.

## Context

Two agents were booted as real Firecracker microVMs on an Intel bare-metal host
(native `/dev/kvm`): the tiny `langgraph-hello` (no model, no network) and the
heavy `youtube-transcriber` (a ~1 GB resident Whisper model). Both run fine as
`docker run` containers. Both broke as microVMs — the trivial one in one way,
the heavy one in three more. Every failure traces to the **same root cause**,
which is the point of this note.

## The unifying principle

**A microVM boots the rootfs directly; it does not run the container runtime.**
`build-rootfs.sh` uses `docker export`, which copies the image's **filesystem
only** — not its `ENV`, `HOME`, `WORKDIR`, or the entropy/DNS/PATH the Docker
runtime injects. The kernel then starts our `/sbin/fc-init` (PID 1) in a bare
environment. So anything the app assumed `docker run` provides is simply absent.
A container hides these assumptions; a microVM exposes them.

## Finding 1 — The guest kernel matters: an old kernel hangs Python

The Firecracker "quickstart" kernel is **4.14**, which predates
`CONFIG_RANDOM_TRUST_CPU`. With no entropy device, its CRNG never finishes
initialising, so a **blocking `getrandom()` never returns** — and Python's
`pydantic` (the `Secret` type) calls it at import. Symptom: uvicorn starts,
prints nothing, never binds; `curl` gets connection-refused; a faulthandler
dump showed the hang deep in `pydantic/types.py`.

**Fix**: default to a modern **5.10** CI kernel (trusts RDRAND → CRNG seeds in
~0.01 s on bare metal) and add a virtio-rng `entropy` device +
`random.trust_cpu=on` as belt-and-suspenders.

## Finding 2 — No `PATH` in PID 1

The kernel hands init an empty environment, and `/bin/sh`'s internal default
`PATH` is **not exported to child processes**. So `exec uvicorn` worked (the
shell found it internally) but the app's `shutil.which("yt-dlp")` returned
`None` (yt-dlp is in `/usr/local/bin`) → "missing prerequisites" at startup.
`langgraph-hello` never hit this because it has no such check.

**Fix**: `fc-init` exports an explicit `PATH`.

## Finding 3 — No DNS resolver

A `docker export`ed rootfs has no `/etc/resolv.conf`, so any name lookup in the
guest fails with `Temporary failure in name resolution`. The transcriber's model
loader tried to reach huggingface.co and crashed PID 1 → kernel panic.

**Fix**: `build-rootfs.sh` writes a default `/etc/resolv.conf` (nameserver
`1.1.1.1`, override via `DNS_SERVER`).

## Finding 4 — `HOME=/`, so the baked cache is invisible (the subtle one)

Even with offline mode forced (`HF_HUB_OFFLINE=1`, confirmed active), the
transcriber still failed. The kernel starts init with **`HOME=/`**, so
huggingface_hub looked in `//.cache/huggingface` (empty) while the baked weights
sat at **`/root/.cache/huggingface`**. A container gets `HOME=/root` from the
Docker runtime; the microVM does not.

**Fix (the general one)**: `fc-init` now sets `HOME=/root` **and sources the
image's declared ENV** — captured at build time via
`docker inspect --format '{{range .Config.Env}}...'` into `/etc/fc-env`. This
replicates what `docker run` would provide (PATH, `HF_HUB_OFFLINE`, etc.), so
every future agent inherits its image environment inside the VM. This subsumes
Finding 2.

## Result

| Agent | Container | microVM (before) | microVM (after fixes) |
|---|---|---|---|
| `langgraph-hello` | ✅ | hung (Finding 1) | ✅ guest kernel 5.10.233, serves |
| `youtube-transcriber` | ✅ | crashed (2, 3, 4) | ✅ model_loaded in ~8 s, serves |

Verified with the **committed** tooling and default boot, no overrides. The
lesson worth keeping: **when moving a container to a microVM, replicate the
runtime environment `docker run` provides — env, HOME, DNS, entropy, PATH — and
prefer a modern guest kernel.** Producing real transcript *content* remains
externally blocked (YouTube bot-blocks datacenter IPs; needs cookies), which is
policy, not a microVM defect.
