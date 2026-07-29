import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { config } from '../config.js'
import { db } from '../db/pool.js'
import { hashPassword, verifyPassword } from '../lib/password.js'
import { blindIndex, encryptField } from '../lib/pii.js'
import { createSession, loadSessionSubject, revokeRefreshToken, rotateSession } from '../auth/session.js'
import { authenticate } from '../auth/guard.js'
import { audit } from '../services/audit.js'
import { hashRefreshToken } from '../lib/tokens.js'

const registerSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(12).max(200),
  displayName: z.string().trim().min(2).max(80),
  workspaceName: z.string().trim().min(2).max(100)
})

const loginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(200)
})

const passwordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(12).max(200)
})
const idSchema = z.uuid()

const dummyPasswordHash = hashPassword(randomBytes(32).toString('base64url'))

function cookieOptions() {
  return {
    path: '/api/v1/auth',
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    domain: config.COOKIE_DOMAIN || undefined,
    maxAge: config.REFRESH_TOKEN_TTL_DAYS * 86_400
  }
}

function setRefreshCookie(reply: FastifyReply, refreshToken: string): void {
  reply.setCookie('monitc_refresh', refreshToken, cookieOptions())
}

function clearRefreshCookie(reply: FastifyReply): void {
  reply.clearCookie('monitc_refresh', cookieOptions())
}

async function requireTrustedCookieOrigin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (config.NODE_ENV !== 'production') return
  const origin = request.headers.origin
  if (origin !== config.APP_ORIGIN && origin !== config.ADMIN_ORIGIN) {
    await reply.code(403).send({ error: 'untrusted_origin' })
  }
}

function makeSlug(): string {
  return `workspace-${randomBytes(9).toString('hex')}`
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/register', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error', details: parsed.error.flatten() })
    const input = parsed.data
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      const emailLookupHash = blindIndex(input.email, 'user.email')
      const duplicate = await client.query('SELECT 1 FROM users WHERE email_lookup_hash = $1', [emailLookupHash])
      if (duplicate.rowCount) {
        await client.query('ROLLBACK')
        return reply.code(409).send({ error: 'email_exists', message: 'An account already exists for this email.' })
      }

      const passwordHash = await hashPassword(input.password)
      const userResult = await client.query<{ id: string }>(
        `INSERT INTO users
          (email_ciphertext, email_lookup_hash, password_hash, display_name_ciphertext)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [
          encryptField(input.email.trim().toLowerCase(), 'user.email'),
          emailLookupHash,
          passwordHash,
          encryptField(input.displayName, 'user.displayName')
        ]
      )
      const userId = userResult.rows[0]!.id
      const workspaceResult = await client.query<{ id: string }>(
        `INSERT INTO workspaces (name_ciphertext, slug) VALUES ($1, $2) RETURNING id`,
        [encryptField(input.workspaceName, 'workspace.name'), makeSlug()]
      )
      const workspaceId = workspaceResult.rows[0]!.id
      await client.query(
        'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)',
        [workspaceId, userId, 'owner']
      )
      await client.query(
        `INSERT INTO subscriptions (workspace_id, plan_code, status, source)
         VALUES ($1, 'community', 'active', 'signup')`,
        [workspaceId]
      )
      await client.query('COMMIT')

      const subject = await loadSessionSubject(userId, workspaceId)
      if (!subject) throw new Error('Unable to create session subject')
      const session = await createSession(subject, request)
      setRefreshCookie(reply, session.refreshToken)
      await audit({
        workspaceId,
        actorUserId: userId,
        action: 'auth.registered',
        resourceType: 'user',
        resourceId: userId
      })
      const { refreshToken: _, ...response } = session
      return reply.code(201).send(response)
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      if ((error as { code?: string }).code === '23505') {
        return reply.code(409).send({ error: 'email_exists', message: 'An account already exists for this email.' })
      }
      throw error
    } finally {
      client.release()
    }
  })

  app.post('/login', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error' })
    const result = await db.query<{ id: string; password_hash: string; disabled_at: Date | null }>(
      'SELECT id, password_hash, disabled_at FROM users WHERE email_lookup_hash = $1',
      [blindIndex(parsed.data.email, 'user.email')]
    )
    const user = result.rows[0]
    if (!user || user.disabled_at) {
      await verifyPassword(await dummyPasswordHash, parsed.data.password)
      return reply.code(401).send({ error: 'invalid_credentials', message: 'Email or password is incorrect.' })
    }
    const valid = await verifyPassword(user.password_hash, parsed.data.password)
    if (!valid) {
      return reply.code(401).send({ error: 'invalid_credentials', message: 'Email or password is incorrect.' })
    }

    const subject = await loadSessionSubject(user.id)
    if (!subject) return reply.code(403).send({ error: 'no_workspace' })
    const session = await createSession(subject, request)
    await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id])
    setRefreshCookie(reply, session.refreshToken)
    await audit({
      workspaceId: subject.workspace_id,
      actorUserId: user.id,
      action: 'auth.logged_in',
      resourceType: 'session'
    })
    const { refreshToken: _, ...response } = session
    return response
  })

  app.post('/refresh', {
    preHandler: requireTrustedCookieOrigin,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const rawToken = request.cookies.monitc_refresh
    if (!rawToken) return reply.code(401).send({ error: 'missing_refresh_token' })
    const session = await rotateSession(rawToken, request)
    if (!session) {
      clearRefreshCookie(reply)
      return reply.code(401).send({ error: 'invalid_refresh_token' })
    }
    setRefreshCookie(reply, session.refreshToken)
    const { refreshToken: _, ...response } = session
    return response
  })

  app.post('/logout', { preHandler: requireTrustedCookieOrigin }, async (request, reply) => {
    const rawToken = request.cookies.monitc_refresh
    if (rawToken) await revokeRefreshToken(rawToken)
    clearRefreshCookie(reply)
    return reply.code(204).send()
  })

  app.get('/me', { preHandler: authenticate }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'unauthorized' })
    const subject = await loadSessionSubject(request.auth.userId, request.auth.workspaceId)
    if (!subject) return reply.code(401).send({ error: 'session_subject_missing' })
    return {
      user: {
        id: subject.user_id,
        email: subject.email,
        displayName: subject.display_name,
        globalRole: subject.global_role,
        mustChangePassword: subject.must_change_password
      },
      workspace: {
        id: subject.workspace_id,
        name: subject.workspace_name,
        slug: subject.workspace_slug,
        role: subject.workspace_role
      }
    }
  })

  app.post('/password', { preHandler: authenticate }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'unauthorized' })
    const parsed = passwordSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error' })
    const result = await db.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [request.auth.userId])
    const current = result.rows[0]
    if (!current || !(await verifyPassword(current.password_hash, parsed.data.currentPassword))) {
      return reply.code(400).send({ error: 'current_password_invalid' })
    }
    const passwordHash = await hashPassword(parsed.data.newPassword)
    await db.query(
      'UPDATE users SET password_hash = $1, must_change_password = false, updated_at = now() WHERE id = $2',
      [passwordHash, request.auth.userId]
    )
    await db.query(
      'UPDATE refresh_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
      [request.auth.userId]
    )
    clearRefreshCookie(reply)
    return reply.code(204).send()
  })

  app.get('/sessions', { preHandler: authenticate }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'unauthorized' })
    const currentHash = request.cookies.monitc_refresh
      ? hashRefreshToken(request.cookies.monitc_refresh)
      : ''
    const result = await db.query<{
      id: string
      token_hash: string
      expires_at: Date
      rotated_at: Date | null
      revoked_at: Date | null
      created_at: Date
    }>(
      `SELECT id, token_hash, expires_at, rotated_at, revoked_at, created_at
       FROM refresh_sessions
       WHERE user_id = $1 AND workspace_id = $2
         AND expires_at > now() - interval '7 days'
       ORDER BY created_at DESC
       LIMIT 100`,
      [request.auth.userId, request.auth.workspaceId]
    )
    return {
      sessions: result.rows.map((row) => ({
        id: row.id,
        current: row.token_hash === currentHash,
        active: !row.rotated_at && !row.revoked_at && row.expires_at.getTime() > Date.now(),
        createdAt: row.created_at.toISOString(),
        expiresAt: row.expires_at.toISOString()
      }))
    }
  })

  app.delete('/sessions/:id', { preHandler: authenticate }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'unauthorized' })
    const id = idSchema.safeParse((request.params as { id?: string }).id)
    if (!id.success) return reply.code(400).send({ error: 'validation_error' })
    const currentHash = request.cookies.monitc_refresh
      ? hashRefreshToken(request.cookies.monitc_refresh)
      : ''
    const result = await db.query<{ token_hash: string }>(
      `UPDATE refresh_sessions SET revoked_at = COALESCE(revoked_at, now())
       WHERE id = $1 AND user_id = $2 AND workspace_id = $3
       RETURNING token_hash`,
      [id.data, request.auth.userId, request.auth.workspaceId]
    )
    const session = result.rows[0]
    if (!session) return reply.code(404).send({ error: 'session_not_found' })
    if (session.token_hash === currentHash) clearRefreshCookie(reply)
    return reply.code(204).send()
  })

  app.post('/sessions/revoke-others', { preHandler: authenticate }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'unauthorized' })
    const currentHash = request.cookies.monitc_refresh
      ? hashRefreshToken(request.cookies.monitc_refresh)
      : ''
    const result = await db.query(
      `UPDATE refresh_sessions SET revoked_at = now()
       WHERE user_id = $1 AND workspace_id = $2
         AND token_hash <> $3 AND rotated_at IS NULL AND revoked_at IS NULL`,
      [request.auth.userId, request.auth.workspaceId, currentHash]
    )
    return { revoked: result.rowCount || 0 }
  })
}
