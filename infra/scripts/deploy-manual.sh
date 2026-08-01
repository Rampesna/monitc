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
agent_gateway_image="monitc/agent-gateway:${revision}"
env_file="${MONITC_ENV_FILE:-$repo_root/.env.production}"
release_version="${MONITC_RELEASE_VERSION:-$(awk -F'"' '/"version"[[:space:]]*:/ { print $4; exit }' package.json)}"

if [ -z "$release_version" ]; then
  echo "[deploy] could not read the release version from package.json" >&2
  exit 1
fi

required=(docker k3s sha256sum "$kubectl_bin")
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
    node:22.22-bookworm-slim \
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

agent_release_dir="$repo_root/runtime/releases/agent/v$release_version"
mkdir -p "$agent_release_dir"
echo "[deploy] building native agent release v$release_version"
for agent_arch in amd64 arm64; do
  agent_binary="$agent_release_dir/monitc-agent-linux-$agent_arch"
  docker run --rm \
    -e "CGO_ENABLED=0" \
    -e "GOOS=linux" \
    -e "GOARCH=$agent_arch" \
    -e "MONITC_BUILD_VERSION=$release_version" \
    -v "$repo_root:/workspace" \
    -w /workspace/agent \
    golang:1.25.12-alpine \
    sh -ec 'go build -trimpath -ldflags "-s -w -X main.version=$MONITC_BUILD_VERSION" -o "/workspace/runtime/releases/agent/v$MONITC_BUILD_VERSION/monitc-agent-linux-$GOARCH" ./cmd/monitc-agent'
  chmod 755 "$agent_binary"
  (
    cd "$agent_release_dir"
    sha256sum "${agent_binary##*/}" > "${agent_binary##*/}.sha256"
  )
done
install -m 0644 "$repo_root/agent/packaging/systemd/monitc-agent.service" \
  "$agent_release_dir/monitc-agent.service"
printf 'v%s\n' "$release_version" > "$repo_root/runtime/releases/agent/latest.txt"
chown -R 10001:10001 "$repo_root/runtime/releases/agent"

echo "[deploy] building immutable images for $revision"
docker build --pull -f infra/docker/api.Dockerfile -t "$api_image" .
docker build --pull -f infra/docker/web.Dockerfile -t "$web_image" .
docker build --pull -f infra/docker/admin.Dockerfile -t "$admin_image" .
docker build --pull -f infra/docker/agent-gateway.Dockerfile \
  --build-arg "VERSION=$release_version" -t "$agent_gateway_image" .

container_runtime="$("$kubectl_bin" get nodes -o jsonpath='{.items[0].status.nodeInfo.containerRuntimeVersion}')"
case "$container_runtime" in
  docker://*)
    echo "[deploy] K3s uses $container_runtime; locally built images are already available"
    ;;
  containerd://*)
    echo "[deploy] importing images into K3s containerd"
    docker save "$api_image" "$web_image" "$admin_image" "$agent_gateway_image" | k3s ctr images import -
    ;;
  *)
    echo "[deploy] unsupported Kubernetes container runtime: $container_runtime" >&2
    exit 1
    ;;
esac

"$kubectl_bin" apply -f infra/k8s/base/00-namespace.yaml
"$kubectl_bin" -n "$namespace" create secret generic monitc-secrets \
  --from-env-file="$env_file" \
  --dry-run=client \
  -o yaml | "$kubectl_bin" apply -f -
"$kubectl_bin" apply -f infra/k8s/base/01-config.yaml
"$kubectl_bin" apply -f infra/k8s/base/02-storage.yaml
"$kubectl_bin" apply -f infra/k8s/base/10-postgres.yaml
"$kubectl_bin" -n "$namespace" delete job redis-cluster-bootstrap \
  --ignore-not-found \
  --wait=true
"$kubectl_bin" apply -f infra/k8s/base/11-redis-cluster.yaml

echo "[deploy] waiting for stateful services"
"$kubectl_bin" -n "$namespace" rollout status statefulset/postgres --timeout=300s
"$kubectl_bin" -n "$namespace" rollout status statefulset/redis --timeout=300s
"$kubectl_bin" -n "$namespace" wait --for=condition=complete job/redis-cluster-bootstrap --timeout=300s

"$kubectl_bin" apply -f infra/k8s/base/12-backups.yaml
backup_phase="$("$kubectl_bin" -n "$namespace" get pvc backups -o jsonpath='{.status.phase}')"
if [ "$backup_phase" != "Bound" ]; then
  echo "[deploy] binding and validating the backup volume with an initial dump"
  "$kubectl_bin" -n "$namespace" delete job postgres-backup-initial \
    --ignore-not-found \
    --wait=true
  "$kubectl_bin" -n "$namespace" create job \
    --from=cronjob/postgres-backup \
    postgres-backup-initial
  "$kubectl_bin" -n "$namespace" wait \
    --for=condition=complete \
    job/postgres-backup-initial \
    --timeout=300s
fi

sed "s|monitc/api:local|${api_image}|g" infra/k8s/base/20-api.yaml | "$kubectl_bin" apply -f -
sed "s|monitc/web:local|${web_image}|g" infra/k8s/base/21-web.yaml | "$kubectl_bin" apply -f -
sed "s|monitc/admin:local|${admin_image}|g" infra/k8s/base/22-admin.yaml | "$kubectl_bin" apply -f -
sed "s|monitc/agent-gateway:local|${agent_gateway_image}|g" infra/k8s/base/23-agent-gateway.yaml | "$kubectl_bin" apply -f -
"$kubectl_bin" apply -f infra/k8s/base/30-network-policies.yaml

echo "[deploy] waiting for the application rollout"
for deployment in api worker web admin agent-gateway; do
  if ! "$kubectl_bin" -n "$namespace" rollout status "deployment/$deployment" --timeout=360s; then
    echo "[deploy] rollout failed for $deployment" >&2
    "$kubectl_bin" -n "$namespace" describe "deployment/$deployment" >&2 || true
    "$kubectl_bin" -n "$namespace" get pods -o wide >&2 || true
    exit 1
  fi
done

"$repo_root/infra/scripts/sync-releases.sh"
"$repo_root/infra/scripts/verify-live.sh"
echo "[deploy] revision $revision is healthy"
