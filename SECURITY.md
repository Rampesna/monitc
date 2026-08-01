# Security

## Reporting

Do not open a public issue for a suspected vulnerability that could expose credentials, personal
data or remote server access. Contact the maintainer privately through the address in
`package.json` and include the affected version, impact and a minimal reproduction.

## Data classification

| Data | Storage |
|---|---|
| SSH password/private key/passphrase/fingerprint | libsodium sealed-box ciphertext |
| Email and display name | AES-256-GCM ciphertext |
| Workspace, server and alert names | AES-256-GCM ciphertext |
| Contact messages and operator notes | AES-256-GCM ciphertext |
| Passwords | Argon2id hash plus optional external pepper |
| Refresh tokens | SHA-256 digest only |
| Native-agent pairing tokens | SHA-256 digest only; one-time and expiring |
| Access tokens | Not persisted by the browser; kept in memory |
| Native-agent private key | Generated and retained only on the monitored server |
| Native-agent certificate | Short-lived public identity material; renewable over mTLS |
| Metrics and Kubernetes resource samples | Plain operational measurements scoped by workspace |
| IP and user-agent metadata | Context-separated keyed HMAC digest |

AES-GCM encryption uses a random 96-bit nonce and context-specific authenticated data. A separate
HMAC key produces a normalized blind index for email equality lookup; it is never reused as the
encryption key.

## SSH credential boundary

The browser obtains the active vault public key and seals SSH material before sending it. The API
validates the sealed box and persists ciphertext. Background monitoring, SFTP and terminal access
require a worker/API process to decrypt the selected record temporarily in memory.

This protects credentials from a database-only compromise. It is not a zero-knowledge or
user-held-key system: an attacker who controls both the running workload and its vault private key
can access credentials used by that workload. A zero-knowledge design cannot also perform
unattended server-side SSH monitoring without a customer-side agent or an online customer key.

For stronger isolation at scale, move vault decryption to a dedicated service backed by a KMS/HSM,
use envelope keys per workspace, and deploy customer-side agents for environments that require
customer-controlled keys.

## Native-agent trust boundary

Agent-only enrollment removes the need to upload SSH credentials. The API creates a cryptographically
random, single-use pairing token and stores only its SHA-256 digest. The agent exchanges that secret
once over TLS, generates its ECDSA P-256 key locally and receives a seven-day client certificate with
a URI identity bound to the workspace/server record. Subsequent traffic requires TLS 1.3 mutual
authentication; the gateway compares the certificate identity, stream hello and database identity
before accepting telemetry.

The connection is outbound from the monitored server. Batches carry a boot identifier and monotonic
sequence; PostgreSQL uniqueness constraints and server-side acknowledgement make retry safe without
duplicating samples. The gateway validates sample ages, dimensions, finite numeric ranges,
capabilities and payload counts. Pairing attempts are rate-limited before database work.

The gateway is the only long-running workload that mounts the private PKI volume. A constrained
init/export step copies only the public CA certificate into a separate volume for the bootstrap API;
the API process cannot read the CA signing key.

Agent command and file capabilities are denied by default. This release intentionally routes terminal
and SFTP through the existing SSH provider when fallback credentials are configured. Enabling a future
agent capability requires both a signed server policy and an explicit local allow-list; registration
alone must never grant remote shell access.

## Authentication and authorization

- Password policy: 12–200 characters; Argon2id with memory-hard parameters.
- Ed25519 access JWT lifetime: 10 minutes by default.
- Verification pins `EdDSA`, `typ=at+jwt`, issuer and audience.
- Refresh tokens are 384-bit opaque random values in a host-only `HttpOnly`, `Secure`,
  `SameSite=Strict` cookie.
- Every refresh rotates the token. Reuse of a rotated token revokes its full token family.
- Refresh and logout routes validate the browser Origin in production.
- Registration and login have stricter Redis-backed rate limits.
- Workspace roles map to API scopes: viewer, operator, admin and owner.
- Platform routes require the separate `super_admin` global role.
- A generated bootstrap administrator must change the temporary password before using the console.

## Network and remote-target safety

Managed mode resolves the SSH destination before connecting and blocks loopback, link-local,
carrier-grade NAT, RFC1918, multicast and unique-local IPv6 ranges. The resolved address is passed
directly to the SSH client, preventing a second DNS lookup. Self-hosted installations may set
`ALLOW_PRIVATE_TARGETS=true` because their purpose commonly includes private infrastructure.

The API only accepts browser origins configured in `APP_ORIGIN` and `ADMIN_ORIGIN`; the terminal
WebSocket applies the same Origin policy and requires a single-use 30-second Redis ticket.

Always:

- terminate TLS at the reverse proxy;
- proxy the API service only, never PostgreSQL or Redis;
- enable WebSocket upgrades only on the API host;
- restrict ports `9127`–`9129` to loopback/firewall or the reverse proxy;
- expose agent port `9130` only through raw TCP/TLS passthrough; never terminate it at an
  HTTP-only proxy or expose an unencrypted backend listener;
- pin the SSH host key in automated deployment;
- keep Kubernetes Secret encryption at rest enabled.

## Secrets and key lifecycle

`.env.production` and self-hosted `.env` contain the JWT private key, vault key pair, PII keys,
password pepper and database/cache passwords. The agent PKI volume additionally contains the
gateway CA private key. They are excluded from Git and must be backed up separately from the
database with tightly restricted access.

Losing `VAULT_PRIVATE_KEY_B64` makes SSH records unrecoverable. Losing
`PII_ENCRYPTION_KEY_B64` makes encrypted personal fields unrecoverable. Exposing either key
together with the database defeats its at-rest protection.

Current key IDs are stored with SSH ciphertext and JWT headers to support a future staged rotation.
Before rotating a vault or PII key, implement and test re-encryption with both old and new keys
available; never overwrite the only working key.

Losing the agent CA key prevents certificate rotation and new pairing but does not reveal agent
private keys. Restore the CA from its encrypted backup or deliberately create a new CA and re-pair
every agent. Never copy an agent's local identity directory between hosts.

## Storage, retention and backups

The managed cluster runs a daily PostgreSQL custom-format dump, checks it with
`pg_restore --list`, and keeps 14 days locally. A local single-node backup is not disaster
recovery. Copy encrypted backups and the independently encrypted key bundle to a different
provider or physical node and perform scheduled restore drills.

Metric retention is enforced per active plan. Refresh records are cleaned after expiry. Audit
records currently require an explicit operational retention policy before production scale.
High-resolution native samples are retained for 24 hours and compacted into one-minute rollups;
plan retention applies to those rollups. The system does not create one database row per kernel
event or per microsecond.

## Runtime hardening

- API, worker, agent gateway and frontend containers run as non-root.
- Application root filesystems are read-only.
- Linux capabilities are dropped and privilege escalation is disabled.
- K3s workloads use `RuntimeDefault` seccomp.
- Kubernetes NetworkPolicies separate edge, application and data paths.
- API logs redact authorization, cookies, passwords and sealed credentials.
- Request bodies, terminal messages and editor/upload operations have size limits.
- Production errors return a request ID rather than raw internal exceptions.
- The Linux agent uses a hardened systemd unit, bounded local spool storage and an optional eBPF
  collector that degrades safely when kernel features or capabilities are unavailable.

## Dependency status

Production dependency audits are required to have zero known vulnerabilities. As of 2026-08-01,
the desktop, platform and landing-page production dependency trees all pass `npm audit
--omit=dev` with zero findings.

The desktop, customer web app and operator console use React `19.2.8` and React Router `8.3.0`.
The earlier React Router 7 advisory exception has been removed rather than carried as accepted
risk. CI repeats the production audits so a newly disclosed issue cannot be silently ignored.

## Production checklist

- [ ] HTTPS and HSTS are active on all three browser domains.
- [ ] `monitc-agent` raw TLS routing reaches port `9130`; pairing and mTLS reconnection are tested.
- [ ] API WebSocket proxying works and all non-API origins are rejected.
- [ ] Kubernetes Secret encryption at rest reports `Enabled`.
- [ ] `.env.production` is `0600` and has an encrypted off-host backup.
- [ ] Database backup and restore have both been tested.
- [ ] The temporary platform administrator password has been changed.
- [ ] PostgreSQL and Redis have no public listener.
- [ ] SSH host fingerprints are learned once and pinned on subsequent connections.
- [ ] Plan entitlements and workspace roles are tested server-side.
- [ ] Dependency audit exceptions have been reviewed.
- [ ] The agent CA and `.env.production` have separate encrypted off-host backups.
