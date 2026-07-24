#!/usr/bin/env bash
# Render vm-config.json from the template and boot the microVM.
#
#   sudo ./boot.sh
#
# Everything is an env override with a sensible default — this is the single
# parameterization point (image is baked into the rootfs already):
#   FC_DIR      base dir              (default /opt/firecracker)
#   KERNEL      guest kernel          (default $FC_DIR/vmlinux)
#   ROOTFS      ext4 rootfs           (default $FC_DIR/rootfs.ext4)
#   TAP         host tap device       (default tap0)
#   GUEST_IP    VM IP                 (default 172.16.0.2)
#   GATEWAY_IP  host IP on the tap    (default 172.16.0.1)
#   NETMASK                           (default 255.255.255.0)
#   GUEST_MAC                         (default 06:00:AC:10:00:02)
#   VCPUS                             (default 2)
#   MEM_MIB     memory                (default 2048 — fits distil-large-v3)
#   API_SOCK    firecracker api sock  (default /run/firecracker-$TAP.sock)
#
# After boot, reach the service at http://$GUEST_IP:8000 (e.g. /healthz).
set -euo pipefail

FC_DIR="${FC_DIR:-/opt/firecracker}"
export KERNEL="${KERNEL:-$FC_DIR/vmlinux}"
export ROOTFS="${ROOTFS:-$FC_DIR/rootfs.ext4}"
export TAP="${TAP:-tap0}"
export GUEST_IP="${GUEST_IP:-172.16.0.2}"
export GATEWAY_IP="${GATEWAY_IP:-172.16.0.1}"
export NETMASK="${NETMASK:-255.255.255.0}"
export GUEST_MAC="${GUEST_MAC:-06:00:AC:10:00:02}"
export VCPUS="${VCPUS:-2}"
export MEM_MIB="${MEM_MIB:-2048}"
API_SOCK="${API_SOCK:-/run/firecracker-${TAP}.sock}"

[[ $EUID -eq 0 ]] || { echo "run as root (sudo)"; exit 1; }
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

for f in "$KERNEL" "$ROOTFS"; do
    [[ -f "$f" ]] || { echo "missing: $f (run install-firecracker.sh / build-rootfs.sh first)"; exit 1; }
done

cfg="$(mktemp --suffix=.json)"
# envsubst only the placeholders we own, so no stray $VARS in the template break.
envsubst '${KERNEL} ${ROOTFS} ${TAP} ${GUEST_IP} ${GATEWAY_IP} ${NETMASK} ${GUEST_MAC} ${VCPUS} ${MEM_MIB}' \
    < "$here/vm-config.json.tmpl" > "$cfg"

rm -f "$API_SOCK"
echo "==> booting microVM ($VCPUS vCPU, ${MEM_MIB}MiB) — service will be at http://$GUEST_IP:8000"
echo "    config: $cfg   api-sock: $API_SOCK"
exec firecracker --api-sock "$API_SOCK" --config-file "$cfg"
