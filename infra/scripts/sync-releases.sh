#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
kubectl_bin="${KUBECTL_BIN:-kubectl}"
namespace="${MONITC_NAMESPACE:-monitc}"
source_dir="${MONITC_RELEASE_SOURCE:-$repo_root/runtime/releases}"

if ! find "$source_dir" -mindepth 1 -maxdepth 1 -type f -print -quit | grep -q .; then
  echo "[releases] no staged artifacts to synchronize"
  exit 0
fi

"$kubectl_bin" -n "$namespace" wait --for=condition=Ready pod \
  -l app.kubernetes.io/name=api \
  --timeout=180s >/dev/null

api_pod="$("$kubectl_bin" -n "$namespace" get pod \
  -l app.kubernetes.io/name=api \
  --field-selector=status.phase=Running \
  -o jsonpath='{.items[0].metadata.name}')"
source_fingerprint="$(
  find "$source_dir" -maxdepth 1 -type f \
    -printf '%f\0%s\0%T@\0' |
    sort -z |
    sha256sum |
    awk '{print $1}'
)"
synced_fingerprint="$(
  "$kubectl_bin" -n "$namespace" exec "$api_pod" -- \
    sh -ec 'cat /var/lib/monitc/releases/.source-fingerprint 2>/dev/null || true'
)"

if [ "$source_fingerprint" = "$synced_fingerprint" ]; then
  echo "[releases] persistent feed is already synchronized"
  exit 0
fi

echo "[releases] synchronizing staged artifacts into the persistent feed"
tar -C "$source_dir" -cf - . |
  "$kubectl_bin" -n "$namespace" exec -i "$api_pod" -- \
    tar -C /var/lib/monitc/releases -xf -
"$kubectl_bin" -n "$namespace" exec "$api_pod" -- \
  sh -ec "printf '%s\\n' '$source_fingerprint' > /var/lib/monitc/releases/.source-fingerprint"
echo "[releases] synchronization complete"
