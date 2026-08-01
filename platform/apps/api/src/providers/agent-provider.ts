import { db } from '../db/pool.js'
import type {
  ProviderConnectionResult,
  ProviderServerRecord,
  ServerProvider
} from './server-provider.js'

export class AgentProvider implements ServerProvider {
  readonly kind = 'agent' as const
  readonly capabilities = new Set(['host-metrics', 'docker', 'kubernetes'] as const)

  constructor(
    private readonly server: ProviderServerRecord,
    private readonly workspaceId: string
  ) {}

  async testConnection(): Promise<ProviderConnectionResult> {
    const result = await db.query<{
      last_seen_at: Date | null
      agent_version: string
      ebpf_active: boolean
    }>(
      `SELECT last_seen_at, agent_version, ebpf_active
       FROM agent_identities
       WHERE server_id = $1 AND workspace_id = $2 AND revoked_at IS NULL`,
      [this.server.id, this.workspaceId]
    )
    const identity = result.rows[0]
    const connected = Boolean(identity?.last_seen_at && Date.now() - identity.last_seen_at.getTime() < 90_000)
    return {
      ok: connected,
      provider: this.kind,
      status: connected ? 'connected' : identity ? 'offline' : 'pending',
      agentVersion: identity?.agent_version || null,
      ebpfActive: Boolean(identity?.ebpf_active)
    }
  }
}
