# Design: opt-in SSH into agent microVMs

## Approach

A single opt-in switch on `build-rootfs.sh`, resolved into two build-time
actions plus one line in the generated `fc-init`. Nothing runs unless the
operator passes a key.

### Input

- `SSH_PUBKEY` — a public-key string (e.g. `ssh-ed25519 AAAA... comment`), or
- `SSH_PUBKEY_FILE` — a path to a `.pub` file (takes precedence if readable).

If neither yields a key, the build is identical to today (no sshd).

### Build-time (in `build-rootfs.sh`, after the rootfs is populated)

openssh-server is not in the agent images, so it is installed **into the mounted
rootfs via `chroot`**, using the image's own `apt` (our agent images are
Debian-based `python:3.12-slim`). The host shares its network namespace with the
chroot, and `/etc/resolv.conf` is already written, so `apt` reaches the network.

```
# only when a key is provided AND the rootfs has apt (Debian):
mount --bind /dev  $mnt/dev
mount -t proc  none $mnt/proc
mount -t sysfs none $mnt/sys
chroot $mnt sh -c 'apt-get update -qq && \
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends openssh-server && \
  ssh-keygen -A && mkdir -p /run/sshd /root/.ssh'
umount $mnt/sys $mnt/proc $mnt/dev
printf '%s\n' "$SSH_PUBKEY" > $mnt/root/.ssh/authorized_keys   # 0600, dir 0700
```

The bind mounts are also unmounted by the script's cleanup trap so an early
failure never leaves them dangling. Non-Debian rootfs (no `apt`) are skipped
with a `WARN`, not an error.

### Boot-time (in the generated `fc-init`)

When SSH was baked, `fc-init` starts sshd **before** `exec`ing the app (sshd
daemonizes, so it returns and the app still becomes PID 1's successor):

```
mkdir -p /run/sshd && /usr/sbin/sshd && echo "fc-init: sshd started"
```

Disabled builds emit no such line. sshd listens on `0.0.0.0:22`, so it is
reachable at the guest IP from the host over `tap0`.

## Security

- **Off by default** — no key, no sshd, no new packages. Opt-in per build.
- **Key auth only** — root logs in via `authorized_keys`; Debian's default
  `PermitRootLogin prohibit-password` allows key auth and refuses passwords.
- **Private IP only** — the guest is on `172.16.0.2` (the internal tap network),
  reachable from the host or via an SSH tunnel. This change adds **no** inbound
  port-forward; it never puts the VM on a public interface.
- **Debug-oriented** — intended for inspecting/debugging VMs we run. Not a
  production access path, and not for untrusted images (those need the
  Firecracker jailer, a standing v1 non-goal).
- Host keys are generated at build (`ssh-keygen -A`) and baked. For an ephemeral
  debug VM that is acceptable; documented as such.

## Verification

Generate a keypair on the host, rebuild an agent rootfs with its public key,
reboot the VM, and confirm `ssh -i <key> root@172.16.0.2` lands a shell while the
agent's HTTP service still answers. See `tasks.md`.

## Non-goals

- No sshd in the default/production rootfs.
- No password auth, no non-root users, no per-boot host-key rotation.
- No public exposure / port-forwarding (that's the separate reverse-proxy path).
