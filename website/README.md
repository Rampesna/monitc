# monitc website and update feed

The public React landing page, protected release uploader and `electron-updater` compatible static feed run together on port `9119`.

## Start

```bash
cp .env.example .env
# Replace UPDATE_ADMIN_TOKEN with a long random value.
docker compose up -d --build
```

- Website: `http://127.0.0.1:9119`
- Health: `http://127.0.0.1:9119/api/health`
- Release administration: `http://127.0.0.1:9119/admin`
- Updater feed: `http://127.0.0.1:9119/updates`

The `data` directory is mounted into the container and contains release packages, manifests and the public latest-release metadata. It survives image rebuilds.

## Reverse proxy

Proxy `monitc.talhacan.com` to `http://127.0.0.1:9119`. Release uploads can be large, so configure the proxy with a request body limit and long upload timeout:

```nginx
client_max_body_size 1200m;
proxy_read_timeout 1800s;
proxy_send_timeout 1800s;
```
