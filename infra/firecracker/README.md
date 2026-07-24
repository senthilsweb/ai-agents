# infra/firecracker — run an agent as a Firecracker microVM

Generic, agent-agnostic tooling to package **any** container image as a
Firecracker microVM rootfs and boot it on a plain KVM Linux host. It is
parameterized by `(image, vcpus, mem, ip)` and knows nothing about a specific
agent — the running example is `youtube-transcriber`, but the same four scripts
deploy any of the monorepo's containerized agents.

Why this exists (and not Kubernetes / Kata / pyro): the goal is the *simplest*
hand-crafted microVM path — raw Firecracker, one VM, one service. See
`openspec/changes/add-youtube-transcriber-service/design.md`.

## Host requirements

- **Ubuntu 24.04 LTS** (recommended — best-documented Firecracker host; any KVM
  Linux with kernel ≥ 5.10 works).
- `/dev/kvm` present (bare metal, or a VM with nested virtualization enabled).
- `x86_64` or `aarch64`.
- Packages: `curl`, `iptables`, `e2fsprogs` (`mkfs.ext4`), `gettext-base`
  (`envsubst`), and `docker` (to build the image + unpack it into a rootfs).

## One-time host setup

```bash
cd infra/firecracker
sudo ./install-firecracker.sh      # firecracker binary + prebuilt guest kernel
sudo ./setup-net.sh                # tap0 + NAT (VM gets 172.16.0.2)
```

## Per-agent: build the image, then the rootfs, then boot

```bash
# 1. Get the agent image (example: youtube-transcriber, weights baked in).
#    Either pull the CI-built image from GHCR:
docker pull ghcr.io/senthilsweb/youtube-transcriber:latest
docker tag ghcr.io/senthilsweb/youtube-transcriber:latest youtube-transcriber
#    ...or build it locally:
#      cd ../../agents/youtube-transcriber && docker build -t youtube-transcriber .

# 2. Turn the image into an ext4 rootfs (weights are already inside it)
sudo ./build-rootfs.sh youtube-transcriber /opt/firecracker/rootfs.ext4 4096

# 3. Boot the microVM (2 vCPU / 2048 MiB by default — fits distil-large-v3)
sudo ./boot.sh
```

Then, from the host:

```bash
curl http://172.16.0.2:8000/healthz
curl -XPOST http://172.16.0.2:8000/transcribe \
     -H 'content-type: application/json' \
     -d '{"video_id":"EQuCyrwyfXU"}'
# → {"job_id":"...","status":"queued"} ; poll GET /jobs/{id} until "done"
```

## Deploying a *different* agent

Nothing changes except step 1–2 arguments and the start command:

```bash
sudo ./build-rootfs.sh my-other-agent /opt/firecracker/other.ext4 2048 \
     "cd /app && exec python run.py --serve"
sudo ROOTFS=/opt/firecracker/other.ext4 GUEST_IP=172.16.0.3 ./boot.sh
```

## Files

| File | Role |
|---|---|
| `install-firecracker.sh` | firecracker binary + prebuilt `vmlinux` kernel |
| `setup-net.sh` | tap device + `ip_forward` + NAT MASQUERADE (mirrors pyro's `setup-bridge.sh`) |
| `build-rootfs.sh` | `docker export` an image into `rootfs.ext4` + inject `/sbin/fc-init` |
| `vm-config.json.tmpl` | Firecracker machine config template (kernel, drive, net, cpu/mem) |
| `boot.sh` | render the template + `firecracker --config-file` |

## Deliberate v1 simplifications

- **No jailer.** One trusted image, single tenant. If the VM ever runs
  untrusted images, add the Firecracker `jailer` — noted as the hardening step.
- **No auth / no public exposure.** The service binds to the private VM IP;
  putting it on the internet needs an auth layer first (a non-goal for v1).
- **One VM, one tap, one worker.** No snapshot pools, no clustering.
- **Kernel-configured networking.** eth0 is set up by the kernel from the `ip=`
  boot arg, so `fc-init` only mounts pseudo-filesystems and starts the app.

## Notes

- The guest kernel URL in `install-firecracker.sh` is a prebuilt Firecracker
  quickstart kernel. If that URL is stale, drop your own uncompressed `vmlinux`
  at `/opt/firecracker/vmlinux` and re-run.
- CPU only — CTranslate2 (faster-whisper) has no GPU path here, matching the
  agent's design. Size `MEM_MIB` to the model: 2048 MiB fits `distil-large-v3`
  int8; larger models need more.
- Transcripts stay inside the VM (`runs/`), consistent with the copyright
  framing of the transcriber — nothing produced by a run is committed or
  published.
