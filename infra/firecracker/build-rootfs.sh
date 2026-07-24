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
# and execs START_CMD. Requires: docker OR podman, mkfs.ext4 (e2fsprogs), root
# (for the loop mount). Set CONTAINER_ENGINE to force one.
set -euo pipefail

FC_DIR="${FC_DIR:-/opt/firecracker}"
IMAGE="${1:-youtube-transcriber}"
OUT="${2:-$FC_DIR/rootfs.ext4}"
SIZE_MB="${3:-4096}"
START_CMD="${4:-cd /app && exec uvicorn server.app:app --host 0.0.0.0 --port 8000}"

[[ $EUID -eq 0 ]] || { echo "run as root (sudo)"; exit 1; }

# Container engine: Docker or Podman, whichever is present (Rocky/RHEL ship
# Podman; Ubuntu tends to have Docker). Both support pull/create/export the
# same way. Override with CONTAINER_ENGINE=docker|podman.
ENGINE="${CONTAINER_ENGINE:-}"
if [[ -z "$ENGINE" ]]; then
    ENGINE="$(command -v docker || command -v podman || true)"
fi
[[ -n "$ENGINE" ]] || { echo "need docker or podman (dnf install -y podman / apt install docker.io)"; exit 1; }
echo "==> container engine: $ENGINE"

mkdir -p "$(dirname "$OUT")"
mnt="$(mktemp -d)"
cid=""
cleanup() { mountpoint -q "$mnt" && umount "$mnt"; [[ -n "$cid" ]] && "$ENGINE" rm -f "$cid" >/dev/null 2>&1 || true; rmdir "$mnt" 2>/dev/null || true; }
trap cleanup EXIT

echo "==> creating ${SIZE_MB}MB ext4 at $OUT"
rm -f "$OUT"
truncate -s "${SIZE_MB}M" "$OUT"
mkfs.ext4 -q -F "$OUT"
mount -o loop "$OUT" "$mnt"

echo "==> exporting image filesystem: $IMAGE"
cid="$("$ENGINE" create "$IMAGE")"
"$ENGINE" export "$cid" | tar -x -C "$mnt"

# Drop the container-runtime marker files — this rootfs boots as a microVM, not
# a container, so leaving /.dockerenv behind makes in-guest "am I containerized?"
# checks lie. (The real proof it's a VM is the guest kernel differing from the
# host's; this just keeps the marker honest.)
rm -f "$mnt/.dockerenv" "$mnt/run/.containerenv" 2>/dev/null || true

# Give the guest a DNS resolver. A Firecracker rootfs has none by default, so
# any outbound name lookup in the VM fails ("Temporary failure in name
# resolution"). Override the nameserver with DNS_SERVER if you like.
echo "nameserver ${DNS_SERVER:-1.1.1.1}" > "$mnt/etc/resolv.conf"

echo "==> writing /sbin/fc-init (PID 1)"
install -d "$mnt/sbin" "$mnt/proc" "$mnt/sys" "$mnt/dev"
cat > "$mnt/sbin/fc-init" <<EOF
#!/bin/sh
# Firecracker PID 1. eth0 is already configured by the kernel (ip= boot arg).
mount -t proc     proc /proc     2>/dev/null || true
mount -t sysfs    sys  /sys      2>/dev/null || true
mount -t devtmpfs dev  /dev      2>/dev/null || true
# Kernel starts init with no PATH, and /bin/sh's internal default is not
# exported to child processes — so a Python app's shutil.which() would find
# nothing (e.g. yt-dlp in /usr/local/bin). Set an explicit PATH so tools are
# discoverable. PYTHONUNBUFFERED keeps startup logs visible on the console.
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PYTHONUNBUFFERED=1
echo "fc-init: starting workload"
$START_CMD
# If the workload exits, halt cleanly instead of panicking.
poweroff -f 2>/dev/null || { echo o > /proc/sysrq-trigger; }
EOF
chmod 0755 "$mnt/sbin/fc-init"

sync
echo "==> done: $OUT ($(du -h "$OUT" | cut -f1)). Boot it with ./boot.sh"
