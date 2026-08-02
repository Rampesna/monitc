interface ReviewSandboxIdentity {
  workspaceId: string
  configuredWorkspaceId: string
  hasSshSecret: boolean
}

export interface ReviewMetricPoint {
  timestamp: string
  cpuPercent: number
  memoryPercent: number
  diskPercent: number
  networkRxBytesPerSecond: number
  networkTxBytesPerSecond: number
  source: 'agent'
}

export function isAppReviewSandbox(identity: ReviewSandboxIdentity): boolean {
  return Boolean(
    identity.configuredWorkspaceId
      && identity.workspaceId === identity.configuredWorkspaceId
      && !identity.hasSshSecret
  )
}

function timestamp(offsetSeconds = 0): string {
  return new Date(Date.now() - offsetSeconds * 1_000).toISOString()
}

export function reviewMetricPoints(samples = 60, now = Date.now()): ReviewMetricPoint[] {
  const count = Math.max(1, Math.min(samples, 180))
  return Array.from({ length: count }, (_, index) => {
    const age = count - index - 1
    const wave = Math.sin(index / 4)
    const trafficWave = Math.cos(index / 5)
    return {
      timestamp: new Date(now - age * 60_000).toISOString(),
      cpuPercent: Number((34 + wave * 9 + (index % 7) * 0.7).toFixed(1)),
      memoryPercent: Number((57 + Math.sin(index / 7) * 4).toFixed(1)),
      diskPercent: Number((42.3 + index * 0.005).toFixed(1)),
      networkRxBytesPerSecond: Math.round(4_800_000 + trafficWave * 1_300_000),
      networkTxBytesPerSecond: Math.round(1_650_000 + Math.sin(index / 6) * 620_000),
      source: 'agent'
    }
  })
}

export function reviewContainerLogs(containerId: string): string {
  return [
    `${timestamp(18)} INFO  ${containerId} accepted a health-check request`,
    `${timestamp(12)} INFO  cache hit · latency=18ms`,
    `${timestamp(6)} INFO  metrics batch exported · samples=60`,
    `${timestamp()} INFO  service healthy · uptime=3h`
  ].join('\n')
}

export function reviewContainerInspection(containerId: string): Record<string, unknown> {
  return {
    id: containerId,
    name: containerId,
    image: containerId.includes('redis') ? 'redis:7-alpine' : 'monitc/review-service:1.0',
    platform: 'linux/amd64',
    driver: 'overlay2',
    state: {
      status: 'running',
      running: true,
      paused: false,
      restarting: false,
      oomKilled: false,
      dead: false,
      pid: 1842,
      exitCode: 0,
      error: '',
      startedAt: timestamp(10_800),
      finishedAt: null,
      health: { status: 'healthy', failingStreak: 0 }
    },
    restartCount: 0,
    workingDirectory: '/app',
    restartPolicy: { Name: 'unless-stopped', MaximumRetryCount: 0 },
    resources: {
      memory: 536_870_912,
      memoryReservation: 268_435_456,
      nanoCpus: 500_000_000,
      cpuShares: 512
    },
    ports: { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '8080' }] },
    networks: { monitc: { IPAddress: '10.42.0.18' } }
  }
}

export function reviewPodLogs(namespace: string, pod: string): string {
  return [
    `${timestamp(21)} [${namespace}/${pod}] readiness probe succeeded`,
    `${timestamp(14)} [${namespace}/${pod}] request completed status=200 duration=24ms`,
    `${timestamp(7)} [${namespace}/${pod}] telemetry flush complete samples=60`,
    `${timestamp()} [${namespace}/${pod}] serving traffic`
  ].join('\n')
}

export function reviewPodDescription(namespace: string, pod: string): string {
  return [
    `Name:             ${pod}`,
    `Namespace:        ${namespace}`,
    'Status:           Running',
    'Node:             monitc-review-node',
    'QoS Class:        Burstable',
    'CPU Requests:     250m',
    'CPU Limits:       500m',
    'Memory Requests:  256Mi',
    'Memory Limits:    512Mi',
    'Restarts:         0',
    'Conditions:',
    '  Ready           True',
    '  ContainersReady True',
    'Events:',
    '  Normal  Started  Monitc review workload is healthy'
  ].join('\n')
}

export function reviewActionOutput(kind: 'container' | 'pod', resource: string, action: string): string {
  return `${kind} ${resource}: ${action} accepted in the isolated review sandbox`
}
