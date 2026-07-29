import { createHash } from 'node:crypto'
import { Client, type ConnectConfig, type SFTPWrapper } from 'ssh2'
import type { PodResourceMetric } from '@monitc/shared'
import type { VaultSecret } from '../lib/vault.js'
import { resolveAllowedHost } from './host-policy.js'
import { parseCpuMillicores, parseMemoryBytes, percent } from './resource-units.js'

const SYSTEM_COMMAND = String.raw`
set -eu
read _ u n s i w q sq st _ < /proc/stat
t1=$((u+n+s+i+w+q+sq+st)); i1=$((i+w))
sleep 0.25
read _ u n s i w q sq st _ < /proc/stat
t2=$((u+n+s+i+w+q+sq+st)); i2=$((i+w))
dt=$((t2-t1)); di=$((i2-i1))
cpu=$(awk -v dt="$dt" -v di="$di" 'BEGIN { if (dt <= 0) print 0; else printf "%.2f", (dt-di)*100/dt }')
mem=$(awk '/MemTotal:/ {t=$2} /MemAvailable:/ {a=$2} END { if (t <= 0) print 0; else printf "%.2f", (t-a)*100/t }' /proc/meminfo)
disk=$(df -P / | awk 'NR==2 {gsub("%","",$5); print $5}')
rx=$(awk '{s+=$1} END {printf "%.0f", s}' /sys/class/net/*/statistics/rx_bytes)
tx=$(awk '{s+=$1} END {printf "%.0f", s}' /sys/class/net/*/statistics/tx_bytes)
up=$(awk '{printf "%.0f", $1}' /proc/uptime)
printf 'cpu=%s\nmemory=%s\ndisk=%s\nrx=%s\ntx=%s\nuptime=%s\n' "$cpu" "$mem" "$disk" "$rx" "$tx" "$up"
`

const KUBECTL = String.raw`export PATH="$PATH:/usr/local/bin:/usr/local/sbin"; export KUBECONFIG="\${KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"; K="$(command -v kubectl 2>/dev/null || true)"; if [ -z "$K" ] && command -v k3s >/dev/null 2>&1; then K="k3s kubectl"; fi; [ -n "$K" ] || exit 127;`

interface SystemSnapshot {
  cpuPercent: number
  memoryPercent: number
  diskPercent: number
  networkRxTotal: number
  networkTxTotal: number
  uptimeSeconds: number
}

interface PodSnapshot extends Omit<PodResourceMetric, 'sampledAt'> {
  networkRxTotal: number
  networkTxTotal: number
}

interface CollectionResult {
  system: SystemSnapshot
  pods: PodSnapshot[]
  fingerprint: string
}

interface K8sObject {
  metadata?: { namespace?: string; name?: string }
  spec?: {
    nodeName?: string
    containers?: Array<{
      resources?: {
        requests?: { cpu?: string; memory?: string }
        limits?: { cpu?: string; memory?: string }
      }
    }>
  }
  status?: {
    phase?: string
    containerStatuses?: Array<{ ready?: boolean; restartCount?: number }>
  }
}

interface MetricsPod {
  metadata?: { namespace?: string; name?: string }
  containers?: Array<{ usage?: { cpu?: string; memory?: string } }>
}

interface StatsSummary {
  pods?: Array<{
    podRef?: { namespace?: string; name?: string }
    network?: { rxBytes?: number; txBytes?: number }
  }>
}

function hostFingerprint(key: Buffer): string {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`
}

export class SshConnection {
  readonly client: Client
  readonly fingerprint: Promise<string>
  private resolveFingerprint!: (value: string) => void

  private constructor(client: Client) {
    this.client = client
    this.fingerprint = new Promise((resolve) => {
      this.resolveFingerprint = resolve
    })
  }

  static async connect(secret: VaultSecret & { hostFingerprint?: string }): Promise<SshConnection> {
    const resolvedHost = await resolveAllowedHost(secret.host)
    const client = new Client()
    const connection = new SshConnection(client)
    const expected = secret.hostFingerprint?.replace(/^sha256:/i, 'SHA256:')
    const connectConfig: ConnectConfig = {
      host: resolvedHost,
      hostHash: 'sha256',
      port: secret.port,
      username: secret.username,
      readyTimeout: 12_000,
      keepaliveInterval: 10_000,
      keepaliveCountMax: 2,
      hostVerifier: (hashedKey: string) => {
        const fingerprint = `SHA256:${hashedKey.replace(/=+$/, '')}`
        connection.resolveFingerprint(fingerprint)
        return !expected || expected === fingerprint
      }
    }
    if (secret.authType === 'privateKey') {
      connectConfig.privateKey = secret.privateKey
      connectConfig.passphrase = secret.passphrase
    } else {
      connectConfig.password = secret.password
    }

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        client.end()
        reject(new Error('SSH_CONNECT_TIMEOUT'))
      }, 15_000)
      client
        .once('ready', () => {
          clearTimeout(timer)
          resolve()
        })
        .once('error', (error) => {
          clearTimeout(timer)
          reject(error)
        })
        .connect(connectConfig)
    })
    return connection
  }

  async exec(command: string, timeoutMs = 20_000): Promise<string> {
    return new Promise((resolve, reject) => {
      this.client.exec(command, (error, stream) => {
        if (error) return reject(error)
        let stdout = ''
        let stderr = ''
        const timer = setTimeout(() => {
          stream.close()
          reject(new Error('SSH_COMMAND_TIMEOUT'))
        }, timeoutMs)
        stream.on('data', (chunk: Buffer) => {
          stdout += chunk.toString('utf8')
        })
        stream.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString('utf8')
        })
        stream.on('close', (code: number | undefined) => {
          clearTimeout(timer)
          if (code && code !== 0) reject(new Error(stderr.trim() || `SSH_COMMAND_${code}`))
          else resolve(stdout)
        })
      })
    })
  }

  async sftp(): Promise<SFTPWrapper> {
    return new Promise((resolve, reject) => {
      this.client.sftp((error, sftp) => (error ? reject(error) : resolve(sftp)))
    })
  }

  close(): void {
    this.client.end()
  }
}

function parseSystem(output: string): SystemSnapshot {
  const values = Object.fromEntries(
    output
      .split('\n')
      .map((line) => line.trim().split('='))
      .filter((entry) => entry.length === 2)
  )
  return {
    cpuPercent: Number(values.cpu || 0),
    memoryPercent: Number(values.memory || 0),
    diskPercent: Number(values.disk || 0),
    networkRxTotal: Number(values.rx || 0),
    networkTxTotal: Number(values.tx || 0),
    uptimeSeconds: Number(values.uptime || 0)
  }
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function sumResource(
  pod: K8sObject,
  category: 'requests' | 'limits',
  resource: 'cpu' | 'memory'
): number {
  return (pod.spec?.containers || []).reduce((total, container) => {
    const value = container.resources?.[category]?.[resource]
    return total + (resource === 'cpu' ? parseCpuMillicores(value) : parseMemoryBytes(value))
  }, 0)
}

function metricsMap(items: MetricsPod[]): Map<string, { cpu: number; memory: number }> {
  const map = new Map<string, { cpu: number; memory: number }>()
  for (const pod of items) {
    const key = `${pod.metadata?.namespace || 'default'}/${pod.metadata?.name || ''}`
    map.set(
      key,
      (pod.containers || []).reduce(
        (sum, container) => ({
          cpu: sum.cpu + parseCpuMillicores(container.usage?.cpu),
          memory: sum.memory + parseMemoryBytes(container.usage?.memory)
        }),
        { cpu: 0, memory: 0 }
      )
    )
  }
  return map
}

function networkMap(summaries: StatsSummary[]): Map<string, { rx: number; tx: number }> {
  const map = new Map<string, { rx: number; tx: number }>()
  for (const summary of summaries) {
    for (const pod of summary.pods || []) {
      const key = `${pod.podRef?.namespace || 'default'}/${pod.podRef?.name || ''}`
      map.set(key, { rx: pod.network?.rxBytes || 0, tx: pod.network?.txBytes || 0 })
    }
  }
  return map
}

async function collectPods(connection: SshConnection): Promise<PodSnapshot[]> {
  let podsRaw = ''
  try {
    podsRaw = await connection.exec(`${KUBECTL} $K get pods --all-namespaces -o json`)
  } catch (error) {
    if ((error as Error).message.includes('127')) return []
    throw error
  }
  const podsData = parseJson<{ items?: K8sObject[] }>(podsRaw, {})
  const pods = podsData.items || []

  const metricsRaw = await connection
    .exec(`${KUBECTL} $K get --raw /apis/metrics.k8s.io/v1beta1/pods`, 15_000)
    .catch(() => '{}')
  const usageByPod = metricsMap(parseJson<{ items?: MetricsPod[] }>(metricsRaw, {}).items || [])

  const nodeNames = [...new Set(pods.map((pod) => pod.spec?.nodeName || '').filter(Boolean))]
  const summaries: StatsSummary[] = []
  for (const nodeName of nodeNames) {
    if (!/^[a-zA-Z0-9._-]+$/.test(nodeName)) continue
    const raw = await connection
      .exec(`${KUBECTL} $K get --raw /api/v1/nodes/${nodeName}/proxy/stats/summary`, 15_000)
      .catch(() => '{}')
    summaries.push(parseJson<StatsSummary>(raw, {}))
  }
  const networkByPod = networkMap(summaries)

  return pods.map((pod) => {
    const namespace = pod.metadata?.namespace || 'default'
    const name = pod.metadata?.name || 'unknown'
    const key = `${namespace}/${name}`
    const usage = usageByPod.get(key) || { cpu: 0, memory: 0 }
    const network = networkByPod.get(key) || { rx: 0, tx: 0 }
    const statuses = pod.status?.containerStatuses || []
    const readyCount = statuses.filter((status) => status.ready).length
    const cpuRequest = sumResource(pod, 'requests', 'cpu')
    const cpuLimit = sumResource(pod, 'limits', 'cpu')
    const memoryRequest = sumResource(pod, 'requests', 'memory')
    const memoryLimit = sumResource(pod, 'limits', 'memory')
    return {
      namespace,
      name,
      node: pod.spec?.nodeName || '',
      phase: pod.status?.phase || 'Unknown',
      ready: `${readyCount}/${pod.spec?.containers?.length || 0}`,
      restarts: statuses.reduce((total, status) => total + (status.restartCount || 0), 0),
      cpuUsageMillicores: usage.cpu,
      cpuRequestMillicores: cpuRequest,
      cpuLimitMillicores: cpuLimit,
      cpuUsagePercent: percent(usage.cpu, cpuLimit || cpuRequest),
      memoryUsageBytes: usage.memory,
      memoryRequestBytes: memoryRequest,
      memoryLimitBytes: memoryLimit,
      memoryUsagePercent: percent(usage.memory, memoryLimit || memoryRequest),
      networkRxBytesPerSecond: 0,
      networkTxBytesPerSecond: 0,
      networkRxTotal: network.rx,
      networkTxTotal: network.tx
    }
  })
}

export async function collectServer(secret: VaultSecret & { hostFingerprint?: string }): Promise<CollectionResult> {
  const connection = await SshConnection.connect(secret)
  try {
    const [systemOutput, pods, fingerprint] = await Promise.all([
      connection.exec(SYSTEM_COMMAND),
      collectPods(connection),
      connection.fingerprint
    ])
    return { system: parseSystem(systemOutput), pods, fingerprint }
  } finally {
    connection.close()
  }
}
