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

sync_pod="monitc-release-sync"
cleanup() {
  "$kubectl_bin" -n "$namespace" delete pod "$sync_pod" \
    --ignore-not-found --wait=false >/dev/null 2>&1 || true
}
trap cleanup EXIT

cleanup
"$kubectl_bin" -n "$namespace" wait --for=delete "pod/$sync_pod" --timeout=60s >/dev/null 2>&1 || true
"$kubectl_bin" -n "$namespace" apply -f - >/dev/null <<YAML
apiVersion: v1
kind: Pod
metadata:
  name: $sync_pod
  namespace: $namespace
  labels:
    app.kubernetes.io/name: release-sync
    app.kubernetes.io/part-of: monitc
spec:
  restartPolicy: Never
  automountServiceAccountToken: false
  securityContext:
    runAsNonRoot: true
    runAsUser: 10001
    runAsGroup: 10001
    fsGroup: 10001
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: sync
      image: busybox:1.37
      imagePullPolicy: IfNotPresent
      command: [sh, -c, "trap : TERM INT; sleep 3600 & wait"]
      resources:
        requests:
          cpu: 25m
          memory: 32Mi
        limits:
          cpu: 250m
          memory: 512Mi
      securityContext:
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        capabilities:
          drop: [ALL]
      volumeMounts:
        - name: releases
          mountPath: /releases
  volumes:
    - name: releases
      persistentVolumeClaim:
        claimName: releases
YAML
"$kubectl_bin" -n "$namespace" wait --for=condition=Ready "pod/$sync_pod" --timeout=120s >/dev/null

source_fingerprint="$(
  find "$source_dir" -maxdepth 1 -type f \
    -printf '%f\0%s\0%T@\0' |
    sort -z |
    sha256sum |
    awk '{print $1}'
)"
synced_fingerprint="$(
  "$kubectl_bin" -n "$namespace" exec "$sync_pod" -- \
    sh -ec 'cat /releases/.source-fingerprint 2>/dev/null || true'
)"

if [ "$source_fingerprint" = "$synced_fingerprint" ]; then
  echo "[releases] persistent feed is already synchronized"
  exit 0
fi

echo "[releases] synchronizing staged artifacts into the persistent feed"
while IFS= read -r -d '' source_file; do
  file_name="${source_file##*/}"
  source_hash="$(sha256sum "$source_file" | awk '{print $1}')"
  target_hash="$(
    "$kubectl_bin" -n "$namespace" exec "$sync_pod" -- \
      sh -c 'test ! -f "$1" || sha256sum "$1" | cut -d " " -f 1' \
      sh "/releases/$file_name"
  )"
  if [ "$source_hash" = "$target_hash" ]; then
    continue
  fi

  echo "[releases] updating $file_name"
  tar -C "$source_dir" -cf - -- "$file_name" |
    "$kubectl_bin" -n "$namespace" exec -i "$sync_pod" -- \
      tar -C /releases -xf -
done < <(find "$source_dir" -mindepth 1 -maxdepth 1 -type f -print0)

"$kubectl_bin" -n "$namespace" exec "$sync_pod" -- \
  sh -c 'printf "%s\n" "$1" > /releases/.source-fingerprint && sync' \
  sh "$source_fingerprint"
echo "[releases] synchronization complete"
