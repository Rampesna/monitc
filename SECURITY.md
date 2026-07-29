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
| Access tokens | Not persisted by the browser; kept in memory |
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
- pin the SSH host key in automated deployment;
- keep Kubernetes Secret encryption at rest enabled.

## Secrets and key lifecycle

`.env.production` and self-hosted `.env` contain the JWT private key, vault key pair, PII keys,
password pepper and database/cache passwords. They are mode `0600`, excluded from Git and must be
backed up separately from the database.

Losing `VAULT_PRIVATE_KEY_B64` makes SSH records unrecoverable. Losing
`PII_ENCRYPTION_KEY_B64` makes encrypted personal fields unrecoverable. Exposing either key
together with the database defeats its at-rest protection.

Current key IDs are stored with SSH ciphertext and JWT headers to support a future staged rotation.
Before rotating a vault or PII key, implement and test re-encryption with both old and new keys
available; never overwrite the only working key.

## Storage, retention and backups

The managed cluster runs a daily PostgreSQL custom-format dump, checks it with
`pg_restore --list`, and keeps 14 days locally. A local single-node backup is not disaster
recovery. Copy encrypted backups and the independently encrypted key bundle to a different
provider or physical node and perform scheduled restore drills.

Metric retention is enforced per active plan. Refresh records are cleaned after expiry. Audit
records currently require an explicit operational retention policy before production scale.

## Runtime hardening

- API, worker and frontend containers run as non-root.
- Application root filesystems are read-only.
- Linux capabilities are dropped and privilege escalation is disabled.
- K3s workloads use `RuntimeDefault` seccomp.
- Kubernetes NetworkPolicies separate edge, application and data paths.
- API logs redact authorization, cookies, passwords and sealed credentials.
- Request bodies, terminal messages and editor/upload operations have size limits.
- Production errors return a request ID rather than raw internal exceptions.

## Dependency status

Production dependency audits are required to have zero critical advisories.

As of 2026-07-29, npm reports `GHSA-qwww-vcr4-c8h2` against React Router `7.18.2`. The advisory is
specific to React Server Components action handling. monitc uses declarative client-side
`BrowserRouter` applications, has no React Router RSC server/action routes, and therefore does not
expose the vulnerable execution path. No patched 7.x release is available at this date. This
exception must be reviewed when a fixed upstream version is published or if the routing mode
changes.

## Production checklist

- [ ] HTTPS and HSTS are active on all three domains.
- [ ] API WebSocket proxying works and all non-API origins are rejected.
- [ ] Kubernetes Secret encryption at rest reports `Enabled`.
- [ ] `.env.production` is `0600` and has an encrypted off-host backup.
- [ ] Database backup and restore have both been tested.
- [ ] The temporary platform administrator password has been changed.
- [ ] PostgreSQL and Redis have no public listener.
- [ ] SSH host fingerprints are learned once and pinned on subsequent connections.
- [ ] Plan entitlements and workspace roles are tested server-side.
- [ ] Dependency audit exceptions have been reviewed.
