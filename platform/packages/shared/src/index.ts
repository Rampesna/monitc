export const PLATFORM_VERSION = '1.5.0'

export type PlanCode = 'community' | 'solo' | 'team' | 'scale'
export type WorkspaceRole = 'owner' | 'admin' | 'operator' | 'viewer'
export type GlobalRole = 'user' | 'super_admin'
export type ServerConnectionMode = 'ssh' | 'agent'

export interface PlanEntitlements {
  servers: number | null
  seats: number | null
  retentionDays: number
  minimumPollSeconds: number
  webTerminal: boolean
  sftp: boolean
  alerts: boolean
  auditLog: boolean
  agentMode: boolean
  agentSampleIntervalMs: number
  prioritySupport: boolean
}

export interface PlanDefinition {
  code: PlanCode
  name: string
  description: string
  monthlyPrice: number | null
  highlighted?: boolean
  entitlements: PlanEntitlements
  features: string[]
}

export const PLANS: PlanDefinition[] = [
  {
    code: 'community',
    name: 'Community',
    description: 'Local-first monitoring for personal infrastructure.',
    monthlyPrice: 0,
    entitlements: {
      servers: 2,
      seats: 1,
      retentionDays: 1,
      minimumPollSeconds: 60,
      webTerminal: false,
      sftp: false,
      alerts: false,
      auditLog: false,
      agentMode: true,
      agentSampleIntervalMs: 5000,
      prioritySupport: false
    },
    features: ['2 servers', '24-hour metric history', 'Native agent with 5s telemetry', 'Desktop and self-hosted mode']
  },
  {
    code: 'solo',
    name: 'Solo',
    description: 'A focused cloud workspace for independent operators.',
    monthlyPrice: 12,
    highlighted: true,
    entitlements: {
      servers: 5,
      seats: 1,
      retentionDays: 30,
      minimumPollSeconds: 30,
      webTerminal: true,
      sftp: true,
      alerts: true,
      auditLog: false,
      agentMode: true,
      agentSampleIntervalMs: 1000,
      prioritySupport: false
    },
    features: ['5 managed servers', '1s native telemetry', '30-day history', 'Web terminal and SFTP', 'Sustained in-app alert rules']
  },
  {
    code: 'team',
    name: 'Team',
    description: 'Shared operations with controls, context and history.',
    monthlyPrice: 39,
    entitlements: {
      servers: 25,
      seats: 5,
      retentionDays: 90,
      minimumPollSeconds: 15,
      webTerminal: true,
      sftp: true,
      alerts: true,
      auditLog: true,
      agentMode: true,
      agentSampleIntervalMs: 500,
      prioritySupport: true
    },
    features: ['25 managed servers', '500ms native telemetry', '5 team seats', '90-day history', 'RBAC and audit log']
  },
  {
    code: 'scale',
    name: 'Scale',
    description: 'Custom limits, onboarding and operational guarantees.',
    monthlyPrice: null,
    entitlements: {
      servers: null,
      seats: null,
      retentionDays: 365,
      minimumPollSeconds: 10,
      webTerminal: true,
      sftp: true,
      alerts: true,
      auditLog: true,
      agentMode: true,
      agentSampleIntervalMs: 250,
      prioritySupport: true
    },
    features: ['Custom server and seat limits', '250ms native telemetry', '365-day history', 'Dedicated onboarding', 'Custom SLA']
  }
]

export interface PublicUser {
  id: string
  email: string
  displayName: string
  globalRole: GlobalRole
  mustChangePassword: boolean
}

export interface WorkspaceSummary {
  id: string
  name: string
  slug: string
  role: WorkspaceRole
  plan: PlanDefinition
}

export interface AuthSession {
  accessToken: string
  expiresIn: number
  user: PublicUser
  workspace: WorkspaceSummary
}

export interface ServerSummary {
  id: string
  name: string
  connectionMode: ServerConnectionMode
  status: 'pending' | 'connected' | 'degraded' | 'offline'
  host?: string
  port?: number
  username?: string
  sshFallbackConfigured: boolean
  agent?: AgentStatus
  lastSeenAt: string | null
  createdAt: string
}

export interface AgentStatus {
  id: string
  status: 'paired' | 'connected' | 'degraded' | 'offline' | 'revoked'
  version: string
  operatingSystem: string
  architecture: string
  kernelVersion: string
  capabilities: string[]
  enabledCapabilities: string[]
  ebpfActive: boolean
  lastSeenAt: string | null
  lastHeartbeatAt: string | null
  certificateExpiresAt: string
  spoolBytes: number
  spoolBatches: number
}

export interface AgentPairingDetails {
  token: string
  expiresAt: string
  gatewayAddress: string
  gatewayServerName: string
  bootstrapCAUrl: string
  installCommand: string
}

export interface SystemMetricPoint {
  timestamp: string
  cpuPercent: number
  memoryPercent: number
  diskPercent: number
  networkRxBytesPerSecond: number
  networkTxBytesPerSecond: number
  source?: 'ssh' | 'agent' | 'rollup'
}

export interface AgentTelemetryLatest extends SystemMetricPoint {
  sampleIntervalNanos: number
  collectionDurationNanos: number
  monotonicNanos: string | null
  ebpfActive: boolean
  schedulerSwitches: number
  tcpRetransmits: number
  loadAverage1: number
  loadAverage5: number
  loadAverage15: number
}

export interface PodResourceMetric {
  namespace: string
  name: string
  node: string
  phase: string
  ready: string
  restarts: number
  cpuUsageMillicores: number
  cpuRequestMillicores: number
  cpuLimitMillicores: number
  cpuUsagePercent: number | null
  memoryUsageBytes: number
  memoryRequestBytes: number
  memoryLimitBytes: number
  memoryUsagePercent: number | null
  networkRxBytesPerSecond: number
  networkTxBytesPerSecond: number
  sampledAt: string
}

export interface DockerContainerMetric {
  id: string
  name: string
  image: string
  state: string
  status: string
  cpuPercent: number
  memoryUsageBytes: number
  memoryLimitBytes: number
  memoryUsagePercent: number | null
  networkRxBytesPerSecond: number
  networkTxBytesPerSecond: number
  sampledAt: string
}
