# Deployment

## Managed topology

The production manifests target K3s and create all resources in the `monitc` namespace. Existing
applications in other namespaces are not modified.

| Component | Replicas | Persistent data |
|---|---:|---|
| Web | 2 | Read-only desktop release mount |
| Admin | 2 | None |
| API | 2–6 (HPA) | Read/write desktop release mount |
| Collector worker | 1 | PostgreSQL |
| PostgreSQL + pgvector | 1 | 20 Gi `local-path` PVC |
| Redis Cluster | 3 masters | 2 Gi PVC per pod |
| Backup CronJob | Daily | Host backup directory |

The host directory is `/www/wwwroot/monitc`. Persistent desktop releases and PostgreSQL dumps are
under `runtime/releases` and `runtime/backups`.

## DNS and aaPanel reverse proxies

Create these records pointing to the K3s host:

| Domain | Target |
|---|---|
| `monitc.talhacan.com` | `http://127.0.0.1:9127` |
| `monitc-api.talhacan.com` | `http://127.0.0.1:9128` |
| `monitcap.talhacan.com` | `http://127.0.0.1:9129` |

For all three:

1. issue a valid TLS certificate;
2. force HTTP to HTTPS;
3. forward `Host`, `X-Forwarded-For` and `X-Forwarded-Proto`.

For `monitc-api.talhacan.com`, also forward `Upgrade` and `Connection` headers and disable response
buffering for the terminal WebSocket. Large SFTP uploads may require increasing the proxy request
body limit above the API's 2 GiB per-file ceiling.

The web container serves the landing page at `/`, the customer application at `/app`, and desktop
release artifacts at `/updates`.

## First managed install

Prerequisites on the host:

- K3s with metrics-server;
- Docker;
- Git;
- enough disk for three Redis PVCs, PostgreSQL and release/backup files.

Clone the repository:

```bash
git clone https://github.com/Rampesna/monitc.git /www/wwwroot/monitc
cd /www/wwwroot/monitc
```

Enable and verify K3s Secret encryption at rest before creating the application Secret. Consult
the installed K3s version's `k3s secrets-encrypt --help`, then confirm:

```bash
k3s secrets-encrypt status
```

Deploy:

```bash
./infra/scripts/deploy-manual.sh
```

On first run, the script generates `.env.production`, builds immutable images, applies resources,
waits for rollouts and runs live verification. Record the generated `BOOTSTRAP_ADMIN_PASSWORD`
through a secure channel and change it on first login.

## Manual update

Until the GitHub Actions quota is available:

```bash
cd /www/wwwroot/monitc
git fetch origin
git pull --ff-only origin main
./infra/scripts/deploy-manual.sh
```

Every build is tagged with the Git revision and imported into K3s. Deployments use rolling updates
for API/web/admin and `Recreate` for the singleton collector.

If deploying a prepared branch temporarily, explicitly check it out and pull that exact branch;
do not mix uncommitted server changes with the deployment checkout.

## Automated CI/CD

`.github/workflows/deploy-platform.yml` watches managed platform paths on `main` and executes the
same pull/deploy script over pinned SSH.

Required repository/environment secrets:

| Secret | Description |
|---|---|
| `MONITC_DEPLOY_HOST` | Production host |
| `MONITC_DEPLOY_USER` | Restricted deployment SSH user |
| `MONITC_DEPLOY_SSH_KEY` | Ed25519 private deployment key |
| `MONITC_DEPLOY_KNOWN_HOSTS` | Pinned `known_hosts` line |

The current workflow assumes the deployment user can run Docker, K3s and kubectl. For long-term
production use, replace root login with a dedicated user and tightly scoped sudo commands.

## Desktop release synchronization

`.github/workflows/release.yml` requires:

| Secret | Description |
|---|---|
| `MAC_CSC_LINK` | Developer ID Application certificate |
| `MAC_CSC_KEY_PASSWORD` | Certificate password |
| `APPLE_ID` | Apple developer account |
| `APPLE_APP_SPECIFIC_PASSWORD` | Notarization app password |
| `APPLE_TEAM_ID` | Apple developer team |
| `WIN_CSC_LINK` | Optional Windows certificate |
| `WIN_CSC_KEY_PASSWORD` | Optional Windows certificate password |
| `MONITC_DEPLOY_HOST` | Release host |
| `MONITC_DEPLOY_USER` | Release upload user |
| `MONITC_DEPLOY_SSH_KEY` | Release upload SSH key |
| `MONITC_DEPLOY_KNOWN_HOSTS` | Pinned host key |

The workflow uploads already verified packages and updater metadata to
`/www/wwwroot/monitc/runtime/releases`. The API release screen reads the same directory and the web
service exposes it at `/updates`.

## Verification

```bash
./infra/scripts/verify-live.sh
kubectl -n monitc get pods,svc,hpa,pdb,pvc,networkpolicy
kubectl -n monitc top pods
curl --fail http://127.0.0.1:9128/health/ready
curl --fail http://127.0.0.1:9127/health
curl --fail http://127.0.0.1:9129/health
```

The verification script confirms:

- HTTP readiness;
- PostgreSQL `pgcrypto` and `vector` extensions;
- Redis `cluster_state:ok`;
- all application rollouts.

## Backups and recovery

Managed dumps are created daily in `runtime/backups` with PostgreSQL custom format and validated
before retention cleanup.

Manual backup:

```bash
kubectl -n monitc exec statefulset/postgres -- \
  pg_dump -U monitc -d monitc --format=custom --no-owner --no-acl > monitc.dump
```

Test restoration in an isolated PostgreSQL instance:

```bash
createdb monitc_restore_test
pg_restore --exit-on-error --no-owner --no-acl -d monitc_restore_test monitc.dump
```

Database dumps are insufficient by themselves. Preserve an independently encrypted copy of
`.env.production`; without the vault and PII keys, encrypted fields cannot be recovered.

## Rollback

Application images are immutable by Git revision and Deployments keep three ReplicaSet revisions.
Inspect history before rollback:

```bash
kubectl -n monitc rollout history deployment/api
kubectl -n monitc rollout undo deployment/api
```

Repeat for `web` or `admin` if needed. Database migrations in this release are additive; a future
destructive migration must include a tested forward-recovery procedure rather than relying only
on an application rollback.

## Self-hosted deployment

Use [infra/self-hosted/README.md](../infra/self-hosted/README.md) for the Docker Compose profile.
It intentionally uses standalone Redis and loopback-only published ports. Set
`ALLOW_PRIVATE_TARGETS=true` only when the self-hosted collector must reach private infrastructure.
