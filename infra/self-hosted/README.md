# monitc self-hosted

The self-hosted profile runs the same web workspace, private operator console and collector API
with PostgreSQL/pgvector, Redis, a worker and verified daily backups. It defaults to loopback-only
ports so a reverse proxy can terminate TLS.

```bash
npm ci --prefix platform
DEPLOYMENT_MODE=self-hosted \
APP_ORIGIN=https://monitc.example.com \
API_ORIGIN=https://monitc-api.example.com \
ADMIN_ORIGIN=https://monitc-admin.example.com \
node platform/scripts/generate-production-env.mjs infra/self-hosted/.env

docker compose --env-file infra/self-hosted/.env \
  -f infra/self-hosted/docker-compose.yml up -d --build
```

Point the web proxy at `127.0.0.1:9127` and the API/WebSocket proxy at
`127.0.0.1:9128`. The optional operator console listens at `127.0.0.1:9129` and only accepts the
generated super-admin account. Read its one-time credentials from `.env` and change the password
on first login.

Preserve `infra/self-hosted/.env`: losing its vault and PII keys makes encrypted records
unrecoverable. Keep an encrypted off-machine copy of both `.env` and the `backups` volume.
