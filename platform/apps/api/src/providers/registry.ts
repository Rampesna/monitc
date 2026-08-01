import { AgentProvider } from './agent-provider.js'
import type { ProviderServerRecord, ServerProvider } from './server-provider.js'
import { SshProvider } from './ssh-provider.js'

export function resolveServerProvider(
  server: ProviderServerRecord,
  workspaceId: string
): ServerProvider {
  if (server.connection_mode === 'agent') {
    return new AgentProvider(server, workspaceId)
  }
  return new SshProvider(server)
}
