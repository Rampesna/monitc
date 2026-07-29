# monitc website

This package contains the public React landing page. In the current platform deployment it is
built by `infra/docker/web.Dockerfile` and served together with the customer application:

- landing page: `/`
- customer web app: `/app`
- release metadata: `/api/releases/latest`
- desktop update feed: `/updates`

The production Kubernetes service listens on host port `9127`.

```bash
npm ci
npm run dev
npm run build
```

`server/` and `docker-compose.yml` remain as a compatibility profile for the earlier standalone
landing/update service on port `9119`. New managed deployments use the authenticated platform API,
the separate `monitcap.talhacan.com` operator console, and a shared Kubernetes release PVC.
`/www/wwwroot/monitc/runtime/releases` is only the staging directory synchronized into that PVC.
