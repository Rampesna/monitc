import type { FastifyReply, FastifyRequest } from 'fastify'
import { config } from '../config.js'
import { redis } from '../lib/redis.js'
import { verifyAccessToken } from '../lib/tokens.js'
import type { GlobalRole, WorkspaceRole } from '@monitc/shared'

const revocationCache = new Map<string, { revoked: boolean; expiresAt: number }>()

async function accessIsRevoked(userId: string): Promise<boolean> {
  const cached = revocationCache.get(userId)
  if (cached && cached.expiresAt > Date.now()) return cached.revoked
  const revoked = Boolean(await redis.get(`access-revoked-user:${userId}`))
  if (revocationCache.size > 10_000) revocationCache.clear()
  revocationCache.set(userId, {
    revoked,
    expiresAt: Date.now() + (revoked ? 60_000 : 5_000)
  })
  return revoked
}

export async function revokeAccessForUser(userId: string): Promise<void> {
  revocationCache.set(userId, { revoked: true, expiresAt: Date.now() + 60_000 })
  await redis.set(`access-revoked-user:${userId}`, '1', 'EX', config.ACCESS_TOKEN_TTL_SECONDS + 10)
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    await reply.code(401).send({ error: 'unauthorized', message: 'Authentication is required.' })
    return
  }

  try {
    const claims = await verifyAccessToken(header.slice(7))
    if (!claims.sub || await accessIsRevoked(claims.sub)) throw new Error('Access token revoked')
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
