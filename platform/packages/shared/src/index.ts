export const PLATFORM_VERSION = '1.4.0'

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
      prioritySupport: false
    },
    features: ['2 servers', '24-hour metric history', 'Desktop and self-hosted mode', 'Kubernetes workload visibility']
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
      prioritySupport: false
    },
    features: ['5 managed servers', '30-day history', 'Web terminal and SFTP', 'Sustained in-app alert rules']
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
      prioritySupport: true
    },
    features: ['25 managed servers', '5 team seats', '90-day history', 'RBAC and audit log', 'Priority support']
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
      prioritySupport: true
    },
    features: ['Custom server and seat limits', '365-day history', 'SSO-ready architecture', 'Dedicated onboarding', 'Custom SLA']
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
  lastSeenAt: string | null
  createdAt: string
}

export interface SystemMetricPoint {
  timestamp: string
  cpuPercent: number
  memoryPercent: number
  diskPercent: number
  networkRxBytesPerSecond: number
  networkTxBytesPerSecond: number
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
