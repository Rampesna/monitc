export type ServerProviderKind = 'ssh' | 'agent'

export type ServerProviderCapability =
  | 'host-metrics'
  | 'docker'
  | 'kubernetes'
  | 'terminal'
  | 'files'

export interface ProviderConnectionResult {
  ok: boolean
  provider: ServerProviderKind
  status: 'pending' | 'connected' | 'degraded' | 'offline'
  fingerprint?: string
  system?: {
    cpuPercent: number
    memoryPercent: number
    diskPercent: number
    networkRxTotal: number
    networkTxTotal: number
    uptimeSeconds: number
  }
  kubernetesPods?: number
  agentVersion?: string | null
  ebpfActive?: boolean
  rotatedSecretCiphertext?: string
}

export interface ServerProvider {
  readonly kind: ServerProviderKind
  readonly capabilities: ReadonlySet<ServerProviderCapability>
  testConnection(): Promise<ProviderConnectionResult>
}

export interface ProviderServerRecord {
  id: string
  connection_mode: ServerProviderKind
  secret_ciphertext: string | null
  secret_key_id: string | null
}
