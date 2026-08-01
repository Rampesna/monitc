#!/usr/bin/env bash
set -Eeuo pipefail

download_base="${MONITC_AGENT_DOWNLOAD_BASE:-https://monitc.talhacan.com/agent}"
api_origin="${MONITC_API_ORIGIN:-https://monitc-api.talhacan.com}"
gateway_address="${MONITC_AGENT_GATEWAY:-monitc-agent.talhacan.com:443}"
gateway_server_name="${MONITC_AGENT_SERVER_NAME:-monitc-agent.talhacan.com}"
official_gateway_address="monitc-agent.talhacan.com:443"
official_fallback_address="${MONITC_AGENT_FALLBACK_GATEWAY:-45.131.1.244:9130}"
requested_version="${MONITC_AGENT_VERSION:-}"

if [ "$(uname -s)" != "Linux" ]; then
  echo "monitc-agent supports Linux hosts only." >&2
  exit 1
fi
case "$(uname -m)" in
  x86_64|amd64) agent_arch="amd64" ;;
  aarch64|arm64) agent_arch="arm64" ;;
  *) echo "Unsupported CPU architecture: $(uname -m)" >&2; exit 1 ;;
esac
if [ "$(id -u)" -ne 0 ]; then
  echo "Run the installer through sudo so it can install the systemd service." >&2
  exit 1
fi
for command_name in curl grep install openssl sha256sum systemctl timeout; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Missing required command: $command_name" >&2
    exit 1
  }
done

temporary_directory="$(mktemp -d /tmp/monitc-agent-install.XXXXXX)"
cleanup() {
  if [ -n "${pairing_token:-}" ]; then
    pairing_token=""
  fi
  rm -rf -- "$temporary_directory"
}
trap cleanup EXIT

if [ -z "$requested_version" ]; then
  requested_version="$(curl --proto '=https' --tlsv1.2 --fail --silent --show-error --max-time 20 "$download_base/latest.txt")"
fi
case "$requested_version" in
  v[0-9]*.[0-9]*.[0-9]*) ;;
  *) echo "The release channel returned an invalid version." >&2; exit 1 ;;
esac

binary_name="monitc-agent-linux-$agent_arch"
artifact_url="$download_base/$requested_version/$binary_name"
curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location --max-time 180 \
  "$artifact_url" -o "$temporary_directory/$binary_name"
curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location --max-time 30 \
  "$artifact_url.sha256" -o "$temporary_directory/$binary_name.sha256"
(
  cd "$temporary_directory"
  sha256sum --check --status "$binary_name.sha256"
) || {
  echo "Agent checksum verification failed; nothing was installed." >&2
  exit 1
}

curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location --max-time 30 \
  "$api_origin/api/v1/agent/bootstrap-ca" -o "$temporary_directory/gateway-ca.crt"

probe_gateway() {
  local address="$1" output
  output="$(timeout 12 openssl s_client \
    -connect "$address" \
    -servername "$gateway_server_name" \
    -CAfile "$temporary_directory/gateway-ca.crt" \
    -verify_return_error </dev/null 2>&1 || true)"
  grep -Eq 'Verify return code: 0|Verification: OK' <<<"$output"
}

if [ ! -f /etc/monitc-agent/config.yaml ]; then
  if ! probe_gateway "$gateway_address"; then
    if [ "$gateway_address" = "$official_gateway_address" ] && probe_gateway "$official_fallback_address"; then
      gateway_address="$official_fallback_address"
      echo "Agent gateway DNS is not ready; using the verified direct endpoint $gateway_address." >&2
    else
      echo "Cannot verify the agent gateway at $gateway_address; nothing was installed." >&2
      echo "Check DNS/TCP passthrough or set MONITC_AGENT_GATEWAY and MONITC_AGENT_SERVER_NAME." >&2
      exit 1
    fi
  fi
fi

install -d -m 0700 /etc/monitc-agent /var/lib/monitc-agent
install -m 0755 "$temporary_directory/$binary_name" /usr/local/bin/monitc-agent
install -m 0644 "$temporary_directory/gateway-ca.crt" /etc/monitc-agent/gateway-ca.crt

if [ ! -f /etc/monitc-agent/config.yaml ]; then
  config_temporary="$temporary_directory/config.yaml"
  {
    printf '%s\n' 'gateway:'
    printf '  address: %s\n' "$gateway_address"
    printf '  serverName: %s\n' "$gateway_server_name"
    printf '%s\n' '  caFile: /etc/monitc-agent/gateway-ca.crt'
    printf '%s\n' 'stateDirectory: /var/lib/monitc-agent'
    printf '%s\n' 'telemetry:'
    printf '%s\n' '  sampleInterval: 1s'
    printf '%s\n' '  batchInterval: 5s'
    printf '%s\n' '  inventoryInterval: 15s'
    printf '%s\n' '  dockerEnabled: true'
    printf '%s\n' '  dockerSocket: /var/run/docker.sock'
    printf '%s\n' '  kubernetesEnabled: true'
    printf '%s\n' '  kubernetesCommand: kubectl'
    printf '%s\n' '  kubeconfig: ""'
    printf '%s\n' '  ebpfEnabled: true'
    printf '%s\n' '  maxSpoolBytes: 268435456'
    printf '%s\n' 'security:'
    printf '%s\n' '  allowCommandExecution: false'
    printf '%s\n' '  allowFileRead: false'
    printf '%s\n' '  allowFileWrite: false'
    printf '%s\n' '  allowSelfUpdate: false'
  } > "$config_temporary"
  install -m 0600 "$config_temporary" /etc/monitc-agent/config.yaml
fi

service_url="$download_base/$requested_version/monitc-agent.service"
curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location --max-time 30 \
  "$service_url" -o "$temporary_directory/monitc-agent.service"
install -m 0644 "$temporary_directory/monitc-agent.service" /etc/systemd/system/monitc-agent.service

if [ ! -f /var/lib/monitc-agent/identity.crt ]; then
  if [ -z "${MONITC_AGENT_PAIRING_TOKEN:-}" ]; then
    if [ ! -r /dev/tty ]; then
      echo "Set MONITC_AGENT_PAIRING_TOKEN for unattended installation or run this command from an interactive terminal." >&2
      exit 1
    fi
    printf 'One-time pairing token: ' > /dev/tty
    IFS= read -r -s pairing_token < /dev/tty
    printf '\n' > /dev/tty
  else
    pairing_token="$MONITC_AGENT_PAIRING_TOKEN"
  fi
  if [ -z "$pairing_token" ]; then
    echo "The pairing token cannot be empty." >&2
    exit 1
  fi
  umask 077
  token_temporary="$temporary_directory/pairing-token"
  printf '%s' "$pairing_token" > "$token_temporary"
  install -m 0600 "$token_temporary" /etc/monitc-agent/pairing-token
  pairing_token=""
fi

systemctl daemon-reload
systemctl enable monitc-agent.service
systemctl restart monitc-agent.service

for _ in $(seq 1 20); do
  if [ -f /var/lib/monitc-agent/identity.crt ]; then
    echo "monitc-agent $requested_version installed and paired successfully."
    exit 0
  fi
  sleep 1
done
echo "The agent was installed, but pairing has not completed yet." >&2
echo "Inspect it with: sudo journalctl -u monitc-agent -n 80 --no-pager" >&2
exit 1
