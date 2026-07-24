# Spec: microvm-debug-access

## ADDED Requirements

### Requirement: SSH into a microVM is opt-in and off by default
The microVM tooling SHALL NOT include an SSH server unless the operator
explicitly provides a public key. A build with no `SSH_PUBKEY` /
`SSH_PUBKEY_FILE` SHALL produce a rootfs with no `sshd`, no added packages, and
no `authorized_keys` — identical to the pre-change build.

#### Scenario: Default build has no SSH
- **WHEN** `build-rootfs.sh` is run without an SSH key
- **THEN** the rootfs contains no `sshd` and `fc-init` starts only the agent

#### Scenario: Opt-in build enables SSH
- **WHEN** `build-rootfs.sh` is run with `SSH_PUBKEY` (or `SSH_PUBKEY_FILE`) set
- **THEN** the rootfs has `openssh-server` installed, the key in
  `/root/.ssh/authorized_keys`, and `fc-init` starts `sshd`

### Requirement: SSH runs alongside the agent, key-only
When enabled, `sshd` SHALL start before the agent and SHALL NOT prevent the
agent from starting. Authentication SHALL be public-key only (no password
login).

#### Scenario: Shell while the service runs
- **WHEN** SSH is enabled and the VM has booted
- **THEN** `ssh root@<guest-ip>` with the matching private key lands a shell,
  and the agent's own service still answers on its port

#### Scenario: No key, no entry
- **WHEN** an SSH attempt is made without the authorized key
- **THEN** access is refused (no password fallback)

### Requirement: SSH access adds no public exposure
Enabling SSH SHALL NOT add any inbound port-forward or bind the VM to a public
interface. The VM SHALL remain reachable only on its private tap-network IP
(from the host or an SSH tunnel).

#### Scenario: Private-only reachability
- **WHEN** SSH is enabled
- **THEN** the guest is reachable at its private IP from the host, and no host
  DNAT/port-forward rule to the guest is created by this change

### Requirement: Non-Debian rootfs degrade gracefully
If an SSH key is provided but the rootfs has no `apt` (a non-Debian image), the
build SHALL log a warning and continue WITHOUT SSH, rather than failing.

#### Scenario: Alpine image with a key
- **WHEN** `SSH_PUBKEY` is set but the image is not Debian-based
- **THEN** the build prints a warning and produces a working (SSH-less) rootfs
