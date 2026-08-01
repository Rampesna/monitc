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
AGENT_GATEWAY_PUBLIC_ADDRESS=monitc-agent.example.com:443 \
AGENT_GATEWAY_SERVER_NAME=monitc-agent.example.com \
node platform/scripts/generate-production-env.mjs infra/self-hosted/.env

docker compose --env-file infra/self-hosted/.env \
  -f infra/self-hosted/docker-compose.yml up -d --build
```

Point the web proxy at `127.0.0.1:9127` and the API/WebSocket proxy at
`127.0.0.1:9128`. The optional operator console listens at `127.0.0.1:9129` and only accepts the
generated super-admin account. Read its one-time credentials from `.env` and change the password
on first login.

The native gRPC/mTLS gateway listens on `127.0.0.1:9130`. Publish it as a raw TCP/TLS
passthrough (for example `monitc-agent.example.com:443 -> 127.0.0.1:9130`); do not terminate its
client certificate at a regular HTTP reverse proxy. The public CA certificate is exposed safely by
the API bootstrap endpoint, while its private signing key remains in the `agent-pki` volume.

When upgrading an instance whose `.env` predates native agents, add the public endpoint before
deployment. Compose supplies safe filesystem defaults for the remaining gateway settings:

```dotenv
AGENT_GATEWAY_PUBLIC_ADDRESS=monitc-agent.example.com:443
AGENT_GATEWAY_SERVER_NAME=monitc-agent.example.com
MONITC_AGENT_TRUST_DOMAIN=monitc.example.com
AGENT_INSTALL_URL=https://monitc.example.com/install-agent.sh
```

Preserve `infra/self-hosted/.env`: losing its vault and PII keys makes encrypted records
unrecoverable. Keep an encrypted off-machine copy of both `.env` and the `backups` volume.
