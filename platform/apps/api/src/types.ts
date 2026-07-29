import type { GlobalRole, WorkspaceRole } from '@monitc/shared'
import type { AccessClaims } from './lib/tokens.js'

export interface AuthContext {
  claims: AccessClaims
  userId: string
  workspaceId: string
  workspaceRole: WorkspaceRole
  globalRole: GlobalRole
  scopes: Set<string>
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null
  }
}
