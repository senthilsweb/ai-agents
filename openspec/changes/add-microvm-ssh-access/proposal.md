# Proposal: opt-in SSH into agent microVMs (debug access)

> Status: **PROPOSED** — 2026-07-24. Owner: @senthilsweb (requested it).
> Use case: **Get a shell inside a running agent microVM to inspect/debug it.**

## Why

An agent microVM (`infra/firecracker/`) boots the agent's container filesystem
directly: PID 1 is `fc-init` → the app (e.g. uvicorn), and the rootfs — produced
by `docker export` — has **no sshd, no login user, no getty**. So there is no
way to get a shell inside a *running* VM. During the youtube-transcriber
bring-up this was a real friction point: to check a baked file, the env, or a
cookies file, the only options were

- **stop the VM** and loop-mount its ext4 on the host (interrupts the service), or
- boot a **throwaway serial-console shell** (`init=/bin/sh`, which replaces the app).

Neither lets you look inside the VM *while it serves*. For a sandbox we run and
debug repeatedly, that's a gap.

## What changes

Add **opt-in SSH** to the generic tooling — no agent code touched:

- `build-rootfs.sh` gains `SSH_PUBKEY` (a public-key string) and
  `SSH_PUBKEY_FILE` (a path). When either is set, it installs `openssh-server`
  into the rootfs, writes the key to `/root/.ssh/authorized_keys`, and generates
  host keys.
- The generated `fc-init` starts `sshd` (backgrounded) before it starts the app,
  so `ssh root@<guest-ip>` works **while the service runs**.
- **Off by default.** With no `SSH_PUBKEY`, the rootfs is built exactly as today
  — no sshd, no extra packages. Production microVMs stay locked down unless the
  operator explicitly opts in.

Access model: key-only (`PermitRootLogin prohibit-password`), on the VM's
private IP (`172.16.0.2`), reachable from the host or through an SSH tunnel —
never internet-exposed by this change.

## Impact

- Changed: `infra/firecracker/build-rootfs.sh` (+ its generated fc-init),
  `infra/firecracker/README.md`. New capability spec `microvm-debug-access`.
- Unchanged: every agent, every other infra script, the default (no-SSH) rootfs.
- Constraint: works for **Debian-based** agent images (they carry `apt`, which
  the install uses via `chroot`); non-Debian rootfs are skipped with a warning.
- Security: opt-in, key-only, private-IP, debug-oriented. Documented as not a
  production access path and not for untrusted images (which should also get the
  Firecracker jailer — already a noted v1 non-goal).
