/// <reference types="vite/client" />

declare const __APP_VERSION__: string | undefined

// ── AWS types ────────────────────────────────────────────────────────────────

interface AwsAccountInput {
  name: string
  accessKeyId: string
  secretAccessKey: string
  region: string
}

interface AwsAccountFull extends AwsAccountInput {
  id: string
  createdAt: string
}

interface AwsAccountDisplay {
  id: string
  name: string
  accessKeyId: string     // masked
  secretAccessKey: string // masked
  region: string
  createdAt: string
}

interface EC2InstanceSummary {
  instanceId: string
  name: string
  state: string
  instanceType: string
  publicIp: string | null
  privateIp: string | null
  availabilityZone: string
  launchTime: string | null
  platform: string
  vpcId: string | null
}

interface EC2InstanceDetails extends EC2InstanceSummary {
  securityGroups: { id: string; name: string }[]
  iamRole: string | null
  volumes: { id: string; device: string; size: number; type: string }[]
  subnetId: string | null
  keyName: string | null
  architecture: string
  monitoring: string
  tags: Record<string, string>
}

interface SecurityGroupSummary {
  groupId: string
  groupName: string
  description: string
  vpcId: string | null
  inboundRuleCount: number
  outboundRuleCount: number
}

interface EKSClusterSummary {
  name: string
  status: string
  version: string
  endpoint: string
  roleArn: string
  platformVersion: string
  createdAt: string | null
}

interface EKSClusterDetails extends EKSClusterSummary {
  certificateAuthority: string
  vpcId: string | null
  subnetIds: string[]
  securityGroupIds: string[]
  publicAccess: boolean
  privateAccess: boolean
  serviceIpv4Cidr: string | null
  tags: Record<string, string>
}

interface EKSNodeGroup {
  name: string
  status: string
  instanceTypes: string[]
  desiredSize: number
  minSize: number
  maxSize: number
  capacityType: string
  amiType: string
  diskSize: number
  labels: Record<string, string>
}

interface CloudWatchDataPoint {
  timestamp: number
  value: number
}

// ── Metrics types ────────────────────────────────────────────────────────────

interface MetricsHistoryPoint {
  timestamp: number
  cpu: { percent: number; loadAvg: [number, number, number] }
  memory: { total: number; used: number; free: number; percent: number }
  disk: Array<{ source: string; total: number; used: number; available: number; percent: number; mountpoint: string }>
  network: Array<{ name: string; rxBytes: number; txBytes: number; rxPackets: number; txPackets: number }>
  uptime: string
}

interface MonitcAPI {
  servers: {
    list: () => Promise<unknown[]>
    add: (server: unknown) => Promise<unknown>
    update: (server: unknown) => Promise<unknown>
    remove: (serverId: string) => Promise<boolean>
    testConnection: (server: unknown) => Promise<{ success: boolean; error?: string; latency?: number }>
  }
  monitor: {
    start: (serverId: string) => Promise<{ success: boolean; error?: string }>
    stop: (serverId: string) => Promise<boolean>
    getStatus: (serverId: string) => Promise<string>
    onMetricsUpdate: (cb: (metrics: unknown) => void) => () => void
    onConnectionStatus: (cb: (status: unknown) => void) => () => void
    getHistory: (serverId: string, hours?: number) => Promise<MetricsHistoryPoint[]>
  }
  docker: {
    onUpdate: (cb: (data: unknown) => void) => () => void
    action: (serverId: string, action: string, containerId: string) => Promise<unknown>
    inspect: (serverId: string, containerId: string) => Promise<unknown>
  }
  kubernetes: {
    onUpdate: (cb: (data: unknown) => void) => () => void
    podDescribe: (serverId: string, namespace: string, pod: string) => Promise<string>
  }
  logs: {
    startDocker: (serverId: string, containerId: string, tail: number) => Promise<string>
    startK8s: (serverId: string, namespace: string, pod: string, container?: string) => Promise<string>
    stop: (streamId: string) => Promise<boolean>
    onData: (streamId: string, cb: (data: string) => void) => () => void
    onClose: (streamId: string, cb: () => void) => () => void
  }
  alerts: {
    list: () => Promise<unknown[]>
    add: (rule: unknown) => Promise<unknown>
    update: (rule: unknown) => Promise<unknown>
    remove: (ruleId: string) => Promise<boolean>
    onTriggered: (cb: (alert: unknown) => void) => () => void
  }
  settings: {
    getIntegrations: () => Promise<unknown>
    saveIntegrations: (integrations: unknown) => Promise<boolean>
    testSmtp: (config: unknown) => Promise<{ success: boolean; error?: string }>
    testWhatsApp: (config: unknown) => Promise<{ success: boolean; error?: string }>
    testTelegram: (config: unknown) => Promise<{ success: boolean; error?: string }>
  }
  preferences: {
    get: () => Promise<unknown>
    save: (prefs: unknown) => Promise<boolean>
  }
  app: {
    platform: string
    getVersion: () => Promise<string>
    resetData: () => Promise<boolean>
    minimize: () => void
    maximize: () => void
    close: () => void
  }
  aws: {
    accounts: {
      list: () => Promise<AwsAccountDisplay[]>
      add: (account: AwsAccountInput) => Promise<AwsAccountDisplay>
      update: (account: AwsAccountFull) => Promise<AwsAccountDisplay>
      remove: (accountId: string) => Promise<boolean>
      test: (account: AwsAccountInput) => Promise<{ accountId: string; arn: string; userId: string }>
    }
    ec2: {
      listInstances: (accountId: string) => Promise<EC2InstanceSummary[]>
      startInstance: (accountId: string, instanceId: string) => Promise<{ success: boolean }>
      stopInstance: (accountId: string, instanceId: string) => Promise<{ success: boolean }>
      rebootInstance: (accountId: string, instanceId: string) => Promise<{ success: boolean }>
      getDetails: (accountId: string, instanceId: string) => Promise<EC2InstanceDetails>
      listSecurityGroups: (accountId: string) => Promise<SecurityGroupSummary[]>
    }
    eks: {
      listClusters: (accountId: string) => Promise<EKSClusterSummary[]>
      describeCluster: (accountId: string, clusterName: string) => Promise<EKSClusterDetails>
      listNodeGroups: (accountId: string, clusterName: string) => Promise<EKSNodeGroup[]>
      generateKubeconfig: (accountId: string, clusterName: string) => Promise<string>
    }
    cloudwatch: {
      getEC2Metrics: (accountId: string, instanceId: string, metricName: string, hours: number) => Promise<CloudWatchDataPoint[]>
    }
  }
  projects: {
    list: () => Promise<unknown[]>
    add: (link: unknown) => Promise<unknown>
    update: (link: unknown) => Promise<unknown>
    remove: (id: string) => Promise<boolean>
  }
  k8sManage: {
    listNamespaces: (serverId: string) => Promise<unknown[]>
    createNamespace: (serverId: string, name: string) => Promise<unknown>
    deleteNamespace: (serverId: string, name: string) => Promise<unknown>
    listSecrets: (serverId: string, ns: string) => Promise<unknown[]>
    createSecretGeneric: (serverId: string, name: string, ns: string, literals: Record<string, string>) => Promise<unknown>
    createSecretDockerRegistry: (serverId: string, name: string, ns: string, server: string, user: string, pass: string, email: string) => Promise<unknown>
    deleteSecret: (serverId: string, name: string, ns: string) => Promise<unknown>
    listServiceAccounts: (serverId: string, ns: string) => Promise<unknown[]>
    createServiceAccount: (serverId: string, name: string, ns: string) => Promise<unknown>
    getKubeconfig: (serverId: string) => Promise<unknown>
    getCICDKubeconfig: (serverId: string, serverIp: string) => Promise<unknown>
    applyYaml: (serverId: string, yaml: string, ns?: string) => Promise<unknown>
    deleteResource: (serverId: string, type: string, name: string, ns: string) => Promise<unknown>
  }
  rollout: {
    restart: (serverId: string, deployment: string, ns: string) => Promise<unknown>
    status: (serverId: string, deployment: string, ns: string) => Promise<unknown>
    undo: (serverId: string, deployment: string, ns: string, revision?: number) => Promise<unknown>
    history: (serverId: string, deployment: string, ns: string) => Promise<unknown>
    scale: (serverId: string, deployment: string, ns: string, replicas: number) => Promise<unknown>
    setImage: (serverId: string, deployment: string, ns: string, container: string, image: string, tag: string) => Promise<unknown>
  }
  git: {
    pull: (serverId: string, path: string, branch?: string) => Promise<unknown>
    status: (serverId: string, path: string) => Promise<unknown>
    lastCommit: (serverId: string, path: string) => Promise<unknown>
    branches: (serverId: string, path: string) => Promise<string[]>
    log: (serverId: string, path: string, count?: number) => Promise<unknown[]>
  }
  github: {
    test: (config: unknown) => Promise<unknown>
    repos: () => Promise<unknown>
    workflows: (owner: string, repo: string) => Promise<unknown>
    trigger: (owner: string, repo: string, workflowId: string | number, ref: string, inputs?: Record<string, string>) => Promise<unknown>
    runs: (owner: string, repo: string) => Promise<unknown>
    runJobs: (owner: string, repo: string, runId: number) => Promise<unknown>
    setSecret: (owner: string, repo: string, secretName: string, secretValue: string) => Promise<unknown>
    branches: (owner: string, repo: string) => Promise<unknown>
  }
  gitlab: {
    test: (config: unknown) => Promise<unknown>
    projects: () => Promise<unknown>
    pipelines: (projectId: string | number) => Promise<unknown>
    trigger: (projectId: string | number, ref: string, variables?: Record<string, string>) => Promise<unknown>
    pipelineJobs: (projectId: string | number, pipelineId: number) => Promise<unknown>
    setVariable: (projectId: string | number, key: string, value: string) => Promise<unknown>
    branches: (projectId: string | number) => Promise<unknown>
  }
  terminal: {
    open: (serverId: string, cols: number, rows: number) => Promise<{ success: boolean; sessionId?: string; error?: string }>
    write: (sessionId: string, data: string) => void
    resize: (sessionId: string, cols: number, rows: number) => void
    close: (sessionId: string) => Promise<boolean>
    onData: (sessionId: string, cb: (data: string) => void) => () => void
    onClose: (sessionId: string, cb: () => void) => () => void
    onError: (sessionId: string, cb: (error: string) => void) => () => void
  }
}

interface Window {
  monitcAPI: MonitcAPI
}
