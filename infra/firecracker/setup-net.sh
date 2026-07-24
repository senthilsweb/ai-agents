#!/usr/bin/env bash
# Create a tap device + NAT so a Firecracker microVM can reach the network and
# be reached from the host. Idempotent. Run once per tap (or after reboot).
#
#   sudo ./setup-net.sh [TAP] [HOST_CIDR] [GUEST_SUBNET]
#
# Defaults give the VM 172.16.0.2 with the host at 172.16.0.1:
#   TAP           tap device name          (default tap0)
#   HOST_CIDR     host IP on the tap        (default 172.16.0.1/24)
#   GUEST_SUBNET  subnet to NAT             (default 172.16.0.0/24)
#
# This mirrors the known-good recipe in pyro's deploy/setup-bridge.sh, using a
# tap instead of a bridge (one VM, one tap — simplest).
set -euo pipefail

TAP="${1:-tap0}"
HOST_CIDR="${2:-172.16.0.1/24}"
GUEST_SUBNET="${3:-172.16.0.0/24}"

[[ $EUID -eq 0 ]] || { echo "run as root (sudo)"; exit 1; }

WAN_IFACE="$(ip route | awk '/^default/ {print $5; exit}')"
[[ -n "$WAN_IFACE" ]] || { echo "no default route found — cannot set up NAT"; exit 1; }

echo "==> tap $TAP ($HOST_CIDR), NAT $GUEST_SUBNET via $WAN_IFACE"

if ip link show "$TAP" >/dev/null 2>&1; then
    echo "  tap $TAP already exists"
else
    ip tuntap add dev "$TAP" mode tap
    ip addr add "$HOST_CIDR" dev "$TAP"
    ip link set "$TAP" up
    echo "  tap $TAP created"
fi

echo 1 > /proc/sys/net/ipv4/ip_forward

# Add the MASQUERADE rule only if it is not already present.
if ! iptables -t nat -C POSTROUTING -s "$GUEST_SUBNET" -o "$WAN_IFACE" -j MASQUERADE 2>/dev/null; then
    iptables -t nat -A POSTROUTING -s "$GUEST_SUBNET" -o "$WAN_IFACE" -j MASQUERADE
    echo "  NAT rule added"
fi
# Allow forwarding between the tap and the WAN both ways.
iptables -C FORWARD -i "$TAP" -o "$WAN_IFACE" -j ACCEPT 2>/dev/null || \
    iptables -A FORWARD -i "$TAP" -o "$WAN_IFACE" -j ACCEPT
iptables -C FORWARD -i "$WAN_IFACE" -o "$TAP" -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || \
    iptables -A FORWARD -i "$WAN_IFACE" -o "$TAP" -m state --state RELATED,ESTABLISHED -j ACCEPT

echo "==> done. Host reaches the VM at the guest IP you pass to boot.sh (default 172.16.0.2)."
