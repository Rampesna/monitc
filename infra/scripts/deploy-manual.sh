#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

kubectl_bin="${KUBECTL_BIN:-kubectl}"
namespace="monitc"
revision="${DEPLOY_REVISION:-$(git rev-parse --short=12 HEAD 2>/dev/null || date -u +%Y%m%d%H%M)}"
api_image="monitc/api:${revision}"
web_image="monitc/web:${revision}"
admin_image="monitc/admin:${revision}"
env_file="${MONITC_ENV_FILE:-$repo_root/.env.production}"

required=(docker k3s "$kubectl_bin")
for command_name in "${required[@]}"; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "[deploy] missing required command: $command_name" >&2
    exit 1
  }
done

encryption_status="$(k3s secrets-encrypt status 2>&1 || true)"
if ! grep -q 'Encryption Status: Enabled' <<<"$encryption_status"; then
  echo "[deploy] K3s Secret encryption at rest must be enabled before deployment." >&2
  echo "$encryption_status" >&2
  exit 1
fi

if [ ! -f "$env_file" ]; then
  echo "[deploy] generating first-install secrets at $env_file"
  docker run --rm \
    -v "$repo_root:/workspace" \
    -w /workspace/platform \
    node:22.14-bookworm-slim \
    sh -ec 'npm ci --no-audit --no-fund && node scripts/generate-production-env.mjs /workspace/.env.production'
fi
chmod 600 "$env_file"

mkdir -p "$repo_root/runtime/releases" "$repo_root/runtime/backups"
chmod 755 "$repo_root/runtime/releases"
chmod 770 "$repo_root/runtime/backups"
chown -R 10001:10001 "$repo_root/runtime/releases"
chown -R 999:999 "$repo_root/runtime/backups"
find "$repo_root/runtime/releases" -type d -exec chmod 755 {} +
find "$repo_root/runtime/releases" -type f -exec chmod 644 {} +

echo "[deploy] building immutable images for $revision"
docker build --pull -f infra/docker/api.Dockerfile -t "$api_image" .
docker build --pull -f infra/docker/web.Dockerfile -t "$web_image" .
docker build --pull -f infra/docker/admin.Dockerfile -t "$admin_image" .

echo "[deploy] importing images into K3s containerd"
docker save "$api_image" "$web_image" "$admin_image" | k3s ctr images import -

"$kubectl_bin" apply -f infra/k8s/base/00-namespace.yaml
"$kubectl_bin" -n "$namespace" create secret generic monitc-secrets \
  --from-env-file="$env_file" \
  --dry-run=client \
  -o yaml | "$kubectl_bin" apply -f -
"$kubectl_bin" apply -f infra/k8s/base/01-config.yaml
"$kubectl_bin" apply -f infra/k8s/base/10-postgres.yaml
"$kubectl_bin" apply -f infra/k8s/base/11-redis-cluster.yaml

echo "[deploy] waiting for stateful services"
"$kubectl_bin" -n "$namespace" rollout status statefulset/postgres --timeout=300s
"$kubectl_bin" -n "$namespace" rollout status statefulset/redis --timeout=300s
"$kubectl_bin" -n "$namespace" wait --for=condition=complete job/redis-cluster-bootstrap --timeout=300s

"$kubectl_bin" apply -f infra/k8s/base/12-backups.yaml
sed "s|monitc/api:local|${api_image}|g" infra/k8s/base/20-api.yaml | "$kubectl_bin" apply -f -
sed "s|monitc/web:local|${web_image}|g" infra/k8s/base/21-web.yaml | "$kubectl_bin" apply -f -
sed "s|monitc/admin:local|${admin_image}|g" infra/k8s/base/22-admin.yaml | "$kubectl_bin" apply -f -
"$kubectl_bin" apply -f infra/k8s/base/30-network-policies.yaml

echo "[deploy] waiting for the application rollout"
for deployment in api worker web admin; do
  if ! "$kubectl_bin" -n "$namespace" rollout status "deployment/$deployment" --timeout=360s; then
    echo "[deploy] rollout failed for $deployment" >&2
    "$kubectl_bin" -n "$namespace" describe "deployment/$deployment" >&2 || true
    "$kubectl_bin" -n "$namespace" get pods -o wide >&2 || true
    exit 1
  fi
done

"$repo_root/infra/scripts/verify-live.sh"
echo "[deploy] revision $revision is healthy"
