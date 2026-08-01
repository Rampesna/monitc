#!/usr/bin/env bash
set -Eeuo pipefail

kubectl_bin="${KUBECTL_BIN:-kubectl}"
namespace="monitc"

encryption_status="$(k3s secrets-encrypt status)"
grep -q 'Encryption Status: Enabled' <<<"$encryption_status"
grep -q 'Server Encryption Hashes: All hashes match' <<<"$encryption_status"

for claim in releases backups agent-pki data-postgres-0 data-redis-0 data-redis-1 data-redis-2; do
  claim_phase="$("$kubectl_bin" -n "$namespace" get pvc "$claim" -o jsonpath='{.status.phase}')"
  [ "$claim_phase" = "Bound" ]
done

curl --fail --silent --show-error --max-time 10 http://127.0.0.1:9127/health >/dev/null
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:9128/health/ready >/dev/null
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:9129/health >/dev/null
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:9128/api/v1/agent/bootstrap-ca >/dev/null
timeout 10 bash -c '</dev/tcp/127.0.0.1/9130'

for application in api worker web admin agent-gateway postgres redis; do
  "$kubectl_bin" -n "$namespace" wait --for=condition=Ready pod \
    -l "app.kubernetes.io/name=$application" \
    --timeout=180s >/dev/null
done

extensions="$("$kubectl_bin" -n "$namespace" exec statefulset/postgres -- \
  sh -ec 'psql -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT extname FROM pg_extension WHERE extname IN ('"'"'pgcrypto'"'"','"'"'vector'"'"') ORDER BY extname"')"
grep -q '^pgcrypto$' <<<"$extensions"
grep -q '^vector$' <<<"$extensions"

redis_state="$("$kubectl_bin" -n "$namespace" exec redis-0 -- \
  sh -ec 'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning cluster info')"
grep -q 'cluster_state:ok' <<<"$redis_state"

"$kubectl_bin" -n "$namespace" get deploy,statefulset,pods -o wide
