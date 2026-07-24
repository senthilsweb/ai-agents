#!/usr/bin/env bash
# Install Firecracker + a prebuilt guest kernel on a KVM Linux host.
#
# Agent-agnostic: this sets up the host, not any particular agent. Run once.
#
#   sudo ./install-firecracker.sh
#
# Env overrides:
#   FC_DIR       base dir for kernel/rootfs        (default /opt/firecracker)
#   FC_VERSION   Firecracker release to install    (default v1.15.0)
#   KERNEL_URL   prebuilt uncompressed vmlinux URL  (default: FC quickstart)
#   ARCH         x86_64 | aarch64                   (default: uname -m)
set -euo pipefail

FC_DIR="${FC_DIR:-/opt/firecracker}"
FC_VERSION="${FC_VERSION:-v1.15.0}"
ARCH="${ARCH:-$(uname -m)}"
# A MODERN guest kernel (5.10) from Firecracker CI, NOT the ancient 4.14
# quickstart kernel. 4.14 predates CONFIG_RANDOM_TRUST_CPU, so its CRNG never
# finishes initialising without an entropy source and `getrandom()` blocks
# forever — which hangs Python (pydantic) at import inside the microVM. 5.10
# trusts the CPU's RDRAND and seeds instantly on bare metal. Override with
# KERNEL_URL if you need a different version/arch.
KERNEL_URL="${KERNEL_URL:-https://s3.amazonaws.com/spec.ccfc.min/firecracker-ci/v1.12/${ARCH}/vmlinux-5.10.233}"

[[ $EUID -eq 0 ]] || { echo "run as root (sudo)"; exit 1; }

echo "==> preflight: KVM"
if [[ ! -e /dev/kvm ]]; then
    echo "  /dev/kvm not found — Firecracker requires KVM." >&2
    echo "  bare metal: enable VT-x/AMD-V in BIOS." >&2
    echo "  cloud VM:   enable nested virtualization on the host." >&2
    exit 1
fi
echo "  /dev/kvm ok"

mkdir -p "$FC_DIR"

echo "==> Firecracker $FC_VERSION ($ARCH)"
if command -v firecracker >/dev/null 2>&1; then
    echo "  already installed: $(firecracker --version | head -1)"
else
    tmp="$(mktemp -d)"
    url="https://github.com/firecracker-microvm/firecracker/releases/download/${FC_VERSION}/firecracker-${FC_VERSION}-${ARCH}.tgz"
    echo "  downloading $url"
    curl -fsSL "$url" -o "$tmp/fc.tgz"
    tar -xzf "$tmp/fc.tgz" -C "$tmp"
    install -m 0755 "$tmp/release-${FC_VERSION}-${ARCH}/firecracker-${FC_VERSION}-${ARCH}" /usr/local/bin/firecracker
    rm -rf "$tmp"
    echo "  installed: $(firecracker --version | head -1)"
fi

echo "==> guest kernel"
if [[ -f "$FC_DIR/vmlinux" ]]; then
    echo "  already present: $FC_DIR/vmlinux"
else
    echo "  downloading $KERNEL_URL"
    # A prebuilt uncompressed kernel — no kernel build on this host. If this URL
    # is stale, drop your own vmlinux at $FC_DIR/vmlinux and re-run.
    curl -fsSL "$KERNEL_URL" -o "$FC_DIR/vmlinux"
    echo "  saved $FC_DIR/vmlinux ($(du -h "$FC_DIR/vmlinux" | cut -f1))"
fi

echo "==> done. Next: ./setup-net.sh, then ./build-rootfs.sh, then ./boot.sh"
