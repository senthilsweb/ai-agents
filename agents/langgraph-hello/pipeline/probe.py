"""Environment probe — the bit that proves *where* this code is running.

When the agent runs inside a Firecracker microVM, these values are the guest's:
a different kernel from the host, the VM's own hostname and eth0 IP, and a low
PID (the app is started by /sbin/fc-init). That is the whole point of the probe
— it is the smoke test's evidence that the microVM booted and is isolated.
"""

from __future__ import annotations

import os
import platform
import socket


def _uptime_s() -> float | None:
    try:
        with open("/proc/uptime", encoding="utf-8") as fh:
            return round(float(fh.read().split()[0]), 2)
    except (OSError, ValueError):
        return None  # not Linux (e.g. a dev macOS box) — fine, just omit it


def _primary_ip() -> str | None:
    """The address the kernel would use for outbound traffic, without sending
    anything. Inside the microVM this is the guest IP configured from the
    kernel `ip=` boot arg."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))  # no packet leaves; just picks a route
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()


def _containerized() -> bool:
    return os.path.exists("/.dockerenv") or os.path.exists("/run/.containerenv")


def gather_env() -> dict:
    u = platform.uname()
    return {
        "hostname": socket.gethostname(),
        "kernel": u.release,       # differs from the host kernel inside a microVM
        "system": u.system,
        "machine": u.machine,
        "cpu_count": os.cpu_count(),
        "pid": os.getpid(),
        "uptime_s": _uptime_s(),
        "ip": _primary_ip(),
        "containerized": _containerized(),
    }
