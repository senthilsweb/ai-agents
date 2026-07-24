# Tasks: add-microvm-ssh-access

## Gate

Requested by the owner 2026-07-24 ("We need option C"). Opt-in, off by default,
debug-oriented. Debian images only.

## Bolt 1 — implement

- [x] `build-rootfs.sh`: resolve `SSH_PUBKEY` / `SSH_PUBKEY_FILE`; when set and
      the rootfs has `apt`, chroot-install `openssh-server`, `ssh-keygen -A`,
      write `/root/.ssh/authorized_keys` (0600, dir 0700). Bind-mount
      dev/proc/sys for the chroot; cleanup trap uses `umount -R`. Non-Debian
      rootfs → `WARN` + skip.
- [x] Generated `fc-init`: when SSH is enabled, `mkdir -p /run/sshd &&
      /usr/sbin/sshd` before starting the app; `:` no-op otherwise.
- [x] `README.md`: §5b "SSH into a microVM (debug)".

## Bolt 2 — verify (on the bare-metal box, 45.32.92.209)

- [x] Generated a host keypair (`/root/.ssh/microvm`).
- [x] Rebuilt the transcriber rootfs with `SSH_PUBKEY=<pub>`; sshd binary +
      1-line authorized_keys + fc-init sshd line all present in the ext4.
- [x] Booted; `ssh -i /root/.ssh/microvm root@172.16.0.2` → root shell
      (whoami=root, guest kernel 5.10.233).
- [x] `/healthz` still `model_loaded:true` while sshd runs — coexist.
- [x] `langgraph-hello` rebuild with no `SSH_PUBKEY` → no sshd binary, no sshd
      in fc-init. Off-by-default holds.

## Verification (acceptance)

- [x] `ssh root@172.16.0.2` works with the key; refused without it (Permission
      denied — key-only).
- [x] Service unaffected by sshd being present.
