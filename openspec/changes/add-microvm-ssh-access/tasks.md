# Tasks: add-microvm-ssh-access

## Gate

Requested by the owner 2026-07-24 ("We need option C"). Opt-in, off by default,
debug-oriented. Debian images only.

## Bolt 1 — implement

- [ ] `build-rootfs.sh`: resolve `SSH_PUBKEY` / `SSH_PUBKEY_FILE`; when set and
      the rootfs has `apt`, chroot-install `openssh-server`, `ssh-keygen -A`,
      write `/root/.ssh/authorized_keys` (0600, dir 0700). Bind-mount
      dev/proc/sys for the chroot and unmount them (also in the cleanup trap).
      Non-Debian rootfs → `WARN` + skip.
- [ ] Generated `fc-init`: when SSH is enabled, `mkdir -p /run/sshd &&
      /usr/sbin/sshd` before starting the app; no such line otherwise.
- [ ] `README.md`: an "SSH into a microVM (debug)" section.

## Bolt 2 — verify (on the bare-metal box)

- [ ] Generate a host keypair (`ssh-keygen -t ed25519`).
- [ ] Rebuild the transcriber rootfs with `SSH_PUBKEY=<pub>`; confirm sshd +
      authorized_keys present in the ext4.
- [ ] Reboot the VM; `ssh -i <key> root@172.16.0.2` lands a root shell.
- [ ] The agent's HTTP service (`/healthz`) still answers while sshd runs.
- [ ] A default (no-`SSH_PUBKEY`) rebuild has no sshd — off-by-default holds.

## Verification (acceptance)

- [ ] `ssh root@172.16.0.2` works with the key and is refused without it.
- [ ] Service unaffected by sshd being present.
