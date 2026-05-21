export interface Server {
  id: string
  name: string
  host: string
  port: number
  username: string
  authType: 'password' | 'privateKey'
  password?: string
  privateKey?: string
  passphrase?: string
  isDefault: boolean
}

export interface SmtpConfig {
  enabled: boolean
  host: string
  port: number
  username: string
  password: string
  fromAddress: string
  secure: boolean
}

export interface WhatsAppConfig {
  enabled: boolean
  provider: 'twilio' | 'custom'
  accountSid: string
  authToken: string
  phoneNumber: string
  apiUrl?: string
}

export interface TelegramConfig {
  enabled: boolean
  botToken: string
  chatId: string
}

export type MetricType =
  | 'cpu_percent'
  | 'memory_percent'
  | 'disk_percent'
  | 'network_rx_bytes'
  | 'network_tx_bytes'
  | 'k8s_pod_restarts'
  | 'k8s_pod_crash_loop'
  | 'k8s_pod_oom_killed'
  | 'k8s_pod_image_pull_error'
  | 'k8s_node_not_ready'
  | 'k8s_deployment_unavailable'
  | 'docker_container_exited'
  | 'docker_container_restarting'

export interface AlertRule {
  id: string
  name: string
  serverId: string
  metric: MetricType
  operator: 'gt' | 'lt' | 'eq'
  threshold: number
  durationSeconds: number
  channels: ('smtp' | 'whatsapp' | 'telegram')[]
  recipients: string[]
  cooldownMinutes: number
  enabled: boolean
  lastTriggeredAt: number | null
  consecutiveBreaches: number
}

export interface AppPreferences {
  theme: 'dark' | 'light' | 'system'
  pollIntervals: {
    system: number
    docker: number
    kubernetes: number
  }
  sidebarCollapsed: boolean
  language: string
}

export interface GitHubConfig {
  enabled: boolean
  pat: string
  baseUrl: string
}

export interface GitLabConfig {
  enabled: boolean
  pat: string
  baseUrl: string
}

export interface ProjectLink {
  id: string
  serverId: string
  name: string
  provider: 'github' | 'gitlab'
  repoOwner: string
  repoName: string
  repoId?: number
  branch: string
  serverPath: string
  namespace: string
  deploymentName?: string
  containerName?: string
  workflowId?: string
}

export interface AppData {
  servers: Server[]
  integrations: {
    smtp: SmtpConfig | null
    whatsapp: WhatsAppConfig | null
    telegram: TelegramConfig | null
    github: GitHubConfig | null
    gitlab: GitLabConfig | null
  }
  alertRules: AlertRule[]
  preferences: AppPreferences
  projectLinks: ProjectLink[]
}

export interface SystemMetrics {
  serverId: string
  timestamp: number
  cpu: {
    percent: number
    loadAvg: [number, number, number]
  }
  memory: {
    total: number
    used: number
    free: number
    percent: number
  }
  disk: DiskPartition[]
  network: NetworkInterface[]
  uptime: string
}

export interface DiskPartition {
  source: string
  total: number
  used: number
  available: number
  percent: number
  mountpoint: string
}

export interface NetworkInterface {
  name: string
  rxBytes: number
  txBytes: number
  rxPackets: number
  txPackets: number
}

export interface DockerContainer {
  id: string
  names: string
  image: string
  command: string
  created: string
  status: string
  ports: string
  state: string
  cpuPercent?: number
  memPercent?: number
  memUsage?: string
}

export interface DockerImage {
  id: string
  repository: string
  tag: string
  size: string
  created: string
}

export interface DockerNetwork {
  id: string
  name: string
  driver: string
  scope: string
}

export interface DockerVolume {
  name: string
  driver: string
  mountpoint: string
  scope: string
}

export interface K8sPod {
  namespace: string
  name: string
  status: string
  ready: string
  restarts: number
  age: string
  node: string
  ip: string
  containers: string[]
}

export interface K8sService {
  namespace: string
  name: string
  type: string
  clusterIP: string
  externalIP: string
  ports: string
  age: string
}

export interface K8sDeployment {
  namespace: string
  name: string
  ready: string
  upToDate: number
  available: number
  age: string
}

export interface K8sEvent {
  namespace: string
  name: string
  reason: string
  message: string
  type: string
  count: number
  lastTimestamp: string
}

export interface ConnectionStatus {
  serverId: string
  status: 'connected' | 'connecting' | 'disconnected' | 'error'
  error?: string
}
