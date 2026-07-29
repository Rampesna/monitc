import type { FastifyReply, FastifyRequest } from 'fastify'
import { verifyAccessToken } from '../lib/tokens.js'
import type { GlobalRole, WorkspaceRole } from '@monitc/shared'

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    await reply.code(401).send({ error: 'unauthorized', message: 'Authentication is required.' })
    return
  }

  try {
    const claims = await verifyAccessToken(header.slice(7))
    request.auth = {
      claims,
      userId: claims.sub || '',
      workspaceId: claims.workspaceId,
      workspaceRole: claims.workspaceRole as WorkspaceRole,
      globalRole: claims.globalRole as GlobalRole,
      scopes: new Set(claims.scope)
    }
  } catch {
    await reply.code(401).send({ error: 'invalid_token', message: 'The access token is invalid or expired.' })
  }
}

export function requireScope(scope: string) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await authenticate(request, reply)
    if (reply.sent) return
    if (!request.auth?.scopes.has(scope)) {
      await reply.code(403).send({ error: 'forbidden', message: 'Your role does not allow this action.' })
    }
  }
}

export const requirePlatformAdmin = requireScope('platform:admin')
