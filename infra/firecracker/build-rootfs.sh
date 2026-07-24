#!/usr/bin/env bash
# Turn any Docker/OCI image into an ext4 rootfs for a Firecracker microVM.
#
# Agent-agnostic: pass any image and the command to start it. Defaults build
# the youtube-transcriber rootfs, but nothing here is specific to it.
#
#   sudo ./build-rootfs.sh [IMAGE] [OUT.ext4] [SIZE_MB] [START_CMD]
#
#   IMAGE      docker image to unpack     (default youtube-transcriber)
#   OUT        output ext4 file           (default $FC_DIR/rootfs.ext4)
#   SIZE_MB    rootfs size in MB          (default 4096 — room for ~2.5GB image)
#   START_CMD  PID-1 command inside the VM (default: the transcriber's uvicorn)
#
# The VM's network (eth0) is configured by the kernel from the `ip=` boot arg
# set in boot.sh, so the init written here only mounts the pseudo-filesystems
# and execs START_CMD. Requires: docker, mkfs.ext4 (e2fsprogs), root (for mount).
set -euo pipefail

FC_DIR="${FC_DIR:-/opt/firecracker}"
IMAGE="${1:-youtube-transcriber}"
OUT="${2:-$FC_DIR/rootfs.ext4}"
SIZE_MB="${3:-4096}"
START_CMD="${4:-cd /app && exec uvicorn server.app:app --host 0.0.0.0 --port 8000}"

[[ $EUID -eq 0 ]] || { echo "run as root (sudo)"; exit 1; }
command -v docker >/dev/null || { echo "docker is required"; exit 1; }

mkdir -p "$(dirname "$OUT")"
mnt="$(mktemp -d)"
cid=""
cleanup() { mountpoint -q "$mnt" && umount "$mnt"; [[ -n "$cid" ]] && docker rm -f "$cid" >/dev/null 2>&1 || true; rmdir "$mnt" 2>/dev/null || true; }
trap cleanup EXIT

echo "==> creating ${SIZE_MB}MB ext4 at $OUT"
rm -f "$OUT"
truncate -s "${SIZE_MB}M" "$OUT"
mkfs.ext4 -q -F "$OUT"
mount -o loop "$OUT" "$mnt"

echo "==> exporting image filesystem: $IMAGE"
cid="$(docker create "$IMAGE")"
docker export "$cid" | tar -x -C "$mnt"

echo "==> writing /sbin/fc-init (PID 1)"
install -d "$mnt/sbin" "$mnt/proc" "$mnt/sys" "$mnt/dev"
cat > "$mnt/sbin/fc-init" <<EOF
#!/bin/sh
# Firecracker PID 1. eth0 is already configured by the kernel (ip= boot arg).
mount -t proc     proc /proc     2>/dev/null || true
mount -t sysfs    sys  /sys      2>/dev/null || true
mount -t devtmpfs dev  /dev      2>/dev/null || true
echo "fc-init: starting workload"
$START_CMD
# If the workload exits, halt cleanly instead of panicking.
poweroff -f 2>/dev/null || { echo o > /proc/sysrq-trigger; }
EOF
chmod 0755 "$mnt/sbin/fc-init"

sync
echo "==> done: $OUT ($(du -h "$OUT" | cut -f1)). Boot it with ./boot.sh"
