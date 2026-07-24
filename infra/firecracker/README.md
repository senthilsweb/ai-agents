# Agent Sandbox — Firecracker microVMs for our agents

Generic, agent-agnostic tooling to package **any** of the monorepo's container
images as a [Firecracker](https://firecracker-microvm.github.io/) microVM and
boot it on a bare-metal KVM host. Each agent gets its **own kernel** and a
hardware-virtualization boundary — stronger isolation than a container — while
staying dead simple: raw Firecracker, one VM, one service, five shell scripts.

It is parameterized by `(image, vcpus, mem, ip)` and knows nothing about any
specific agent. Verified end-to-end with both `langgraph-hello` (tiny) and
`youtube-transcriber` (a 4.45 GB image with a resident Whisper model).

> Why raw Firecracker and not Kubernetes / Kata / a sandbox product (E2B, pyro)?
> The goal is the **simplest hand-crafted microVM path** we fully control and
> understand. See `openspec/changes/add-youtube-transcriber-service/design.md`.

---

## 1. Pick a host — the `/dev/kvm` rule

Firecracker needs **`/dev/kvm`**. That single requirement decides your host:

| Host type | `/dev/kvm`? | Verdict |
|---|---|---|
| **Bare metal** (Vultr Bare Metal, Equinix Metal, Hetzner *dedicated*) | ✅ native | **Best.** No nested virt to worry about. |
| Cloud VM with nested virt (GCP w/ flag, Azure v3+) | ⚠️ if enabled | Works if you turn nested virtualization on at create time. |
| Standard cloud VM (Hetzner **Cloud**, DigitalOcean droplet, most AWS) | ❌ | **Won't work** — no `/dev/kvm`, Firecracker can't run. |

First command on any new box — if this fails, stop, the host is wrong:

```bash
ls -l /dev/kvm && systemd-detect-virt   # want the device to exist; "none" = bare metal
```

**Recommended host: Ubuntu 24.04 LTS on Intel/AMD bare metal, x86_64.** Rocky /
RHEL 9 works too (see §7).

---

## 2. From a fresh bare-metal box to a running microVM

The exact sequence, start to finish (as root):

```bash
# a. Prerequisites (Ubuntu). Docker is used to unpack images into a rootfs.
apt-get update
apt-get install -y curl tar iptables e2fsprogs gettext-base iproute2 docker.io git

# b. Get this repo
git clone https://github.com/senthilsweb/ai-agents.git /root/ai-agents
cd /root/ai-agents/infra/firecracker

# c. One-time host setup
./install-firecracker.sh    # firecracker binary + a MODERN 5.10 guest kernel
./setup-net.sh              # tap0 (host 172.16.0.1) + NAT; VM will be 172.16.0.2

# d. Get the agent image — build locally...
( cd /root/ai-agents/agents/langgraph-hello && docker build -t langgraph-hello . )
#   ...or pull the CI-built image from GHCR (make the package public, or
#   `docker login ghcr.io` first):
#   docker pull ghcr.io/senthilsweb/langgraph-hello:latest
#   docker tag  ghcr.io/senthilsweb/langgraph-hello:latest langgraph-hello

# e. Image -> ext4 rootfs (size in MB; leave headroom over the image content)
./build-rootfs.sh langgraph-hello /opt/firecracker/lgh.ext4 1024

# f. Boot it
ROOTFS=/opt/firecracker/lgh.ext4 ./boot.sh
```

From the host, the service is at the guest IP:

```bash
curl http://172.16.0.2:8000/healthz
curl http://172.16.0.2:8000/whoami   # kernel/hostname/ip are the GUEST's = proof it's a microVM
```

`boot.sh` runs Firecracker in the foreground (the VM's serial console). To leave
it running detached, background it: see §5.

---

## 3. Spin up a microVM for any agent

The tooling is generic. To deploy a different agent, change the image, the
rootfs size, and (if not a `uvicorn server.app:app` service) the start command:

```bash
# youtube-transcriber (bigger image + a resident model → more disk + RAM)
( cd /root/ai-agents/agents/youtube-transcriber && docker build -t youtube-transcriber . )
./build-rootfs.sh youtube-transcriber /opt/firecracker/yt.ext4 8192
ROOTFS=/opt/firecracker/yt.ext4 MEM_MIB=4096 ./boot.sh

# an agent with a different entrypoint — pass START_CMD as the 4th arg
./build-rootfs.sh my-agent /opt/firecracker/my.ext4 2048 \
    "cd /app && exec python run.py --serve"
ROOTFS=/opt/firecracker/my.ext4 ./boot.sh
```

`build-rootfs.sh` automatically **carries the image's `ENV` and sets `HOME`**
(see §8, Finding 4), so an agent's baked caches and env vars work inside the VM
the same way they do under `docker run`.

### Running several agents at once

One tap serves one VM. For a second VM, give it its own IP (and its own tap if
you want isolation):

```bash
ROOTFS=/opt/firecracker/yt.ext4 GUEST_IP=172.16.0.3 GUEST_MAC=06:00:AC:10:00:03 ./boot.sh
```

---

## 4. Boot knobs (all env vars on `boot.sh`)

| Var | Default | Notes |
|---|---|---|
| `ROOTFS` | `/opt/firecracker/rootfs.ext4` | the ext4 from `build-rootfs.sh` |
| `KERNEL` | `/opt/firecracker/vmlinux` | modern 5.10 by default |
| `MEM_MIB` | `2048` | size to the workload (4096 for the transcriber's model) |
| `VCPUS` | `2` | CPU-only ASR; more vCPU = faster transcription |
| `GUEST_IP` / `GATEWAY_IP` | `172.16.0.2` / `172.16.0.1` | |
| `TAP` | `tap0` | must match `setup-net.sh` |

`build-rootfs.sh` extras: `CONTAINER_ENGINE=docker|podman`, `DNS_SERVER=…`.

---

## 5. Managing microVMs

```bash
# Run detached (survives your SSH session)
cd /root/ai-agents/infra/firecracker
ROOTFS=/opt/firecracker/yt.ext4 MEM_MIB=4096 nohup ./boot.sh > /root/fc.log 2>&1 & disown

tail -f /root/fc.log             # serial console + app logs
pgrep -ax firecracker            # what's running
pkill -x firecracker             # stop ALL microVMs (exact match — safe)
```

### Keep it running across reboots (systemd)

A `nohup` VM dies on reboot. For a long-lived deployment, install a unit that
re-creates the network and boots the VM on start:

```ini
# /etc/systemd/system/agent-microvm.service
[Unit]
Description=Agent microVM (Firecracker)
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/root/ai-agents/infra/firecracker
Environment=ROOTFS=/opt/firecracker/yt.ext4 MEM_MIB=4096
ExecStartPre=/root/ai-agents/infra/firecracker/setup-net.sh
ExecStart=/root/ai-agents/infra/firecracker/boot.sh
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload && systemctl enable --now agent-microvm
```

---

## 6. Files

| File | Role |
|---|---|
| `install-firecracker.sh` | firecracker binary + a modern 5.10 `vmlinux` guest kernel |
| `setup-net.sh` | `tap0` + `ip_forward` + NAT MASQUERADE |
| `build-rootfs.sh` | `docker/podman export` an image into `rootfs.ext4`; inject `/sbin/fc-init`; carry image ENV; strip container markers; add DNS |
| `vm-config.json.tmpl` | Firecracker machine config (kernel, drive, net, cpu/mem, entropy) |
| `boot.sh` | render the template + `firecracker --config-file` |

---

## 7. Rocky / RHEL / Alma 9 host

Nothing here is Ubuntu-specific — the scripts use no `apt`.

```bash
dnf install -y curl tar iptables e2fsprogs gettext iproute podman
```

- **SELinux** is enforcing by default and can block loop-mount / tap / VM ops.
  Quick path for a demo: `setenforce 0`. Permanent: add the right contexts.
- **Podman** (RHEL-family default) is auto-detected by `build-rootfs.sh`; force
  it with `CONTAINER_ENGINE=podman`.

---

## 8. Lessons learned — what a container hides

A microVM boots the rootfs directly; it does **not** run the container runtime.
`docker export` copies the filesystem only — not the image's `ENV`, `HOME`, or
the entropy/DNS/PATH the Docker runtime injects. So assumptions a container
satisfies silently fail in a microVM. Full write-up:
**`openspec/observations/0003-firecracker-microvm-bringup.md`**. In brief:

| # | What broke (microVM only) | Fix (all in this tooling) |
|---|---|---|
| 1 | Old **4.14** guest kernel → `getrandom()` blocked → Python hung at import | default **5.10** kernel (trusts RDRAND) + virtio-rng entropy device |
| 2 | No **`PATH`** in PID 1 → `shutil.which("yt-dlp")` found nothing | `fc-init` exports `PATH` |
| 3 | No **DNS** resolver → name lookups fail | `build-rootfs.sh` writes `/etc/resolv.conf` |
| 4 | **`HOME=/`** → baked HuggingFace cache at `/root/.cache` invisible | `fc-init` sets `HOME=/root` **and carries the image's ENV** via `docker inspect` |

The rule of thumb: **when moving a container to a microVM, replicate the runtime
environment `docker run` provides — env, HOME, DNS, entropy, PATH — and use a
modern guest kernel.**

---

## 9. Deliberate v1 simplifications

- **No jailer.** One trusted image, single tenant. Add the Firecracker `jailer`
  before running untrusted images.
- **No auth / no public exposure.** The service binds to the private VM IP;
  putting it on the internet needs an auth layer first.
- **One VM, one tap, one worker.** No snapshot pools, no clustering.
- **Kernel-configured networking.** `eth0` is set up by the kernel from the
  `ip=` boot arg; `fc-init` only mounts pseudo-filesystems, sets the env, and
  starts the app.
- **CPU only.** No GPU passthrough — CTranslate2 (faster-whisper) has no GPU path
  here anyway.
- Anything a run produces (e.g. transcripts) stays **inside the VM**, consistent
  with each agent's copyright/privacy framing.
