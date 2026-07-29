import type { FastifyInstance } from 'fastify'
import { PLANS } from '@monitc/shared'
import { z } from 'zod'
import { requireScope } from '../auth/guard.js'
import { db } from '../db/pool.js'
import { blindIndex, decryptField } from '../lib/pii.js'
import { audit } from '../services/audit.js'

const idSchema = z.uuid()
const addMemberSchema = z.object({
  email: z.email().max(254),
  role: z.enum(['admin', 'operator', 'viewer'])
})
const changeRoleSchema = z.object({
  role: z.enum(['admin', 'operator', 'viewer'])
})

interface MemberRow {
  user_id: string
  email_ciphertext: string
  display_name_ciphertext: string
  role: 'owner' | 'admin' | 'operator' | 'viewer'
  created_at: Date
}

function publicMember(row: MemberRow) {
  return {
    userId: row.user_id,
    email: decryptField(row.email_ciphertext, 'user.email'),
    displayName: decryptField(row.display_name_ciphertext, 'user.displayName'),
    role: row.role,
    joinedAt: row.created_at.toISOString()
  }
}

async function hasAuditLog(workspaceId: string): Promise<boolean> {
  const result = await db.query<{ enabled: boolean }>(
    `SELECT COALESCE((p.entitlements->>'auditLog')::boolean, false) AS enabled
     FROM subscriptions s
     JOIN plans p ON p.code = s.plan_code
     WHERE s.workspace_id = $1 AND s.status IN ('active', 'trialing')`,
    [workspaceId]
  )
  return result.rows[0]?.enabled || false
}

export async function workspaceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/current', { preHandler: requireScope('workspace:read') }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'unauthorized' })
    const result = await db.query<{
      id: string
      name_ciphertext: string
      slug: string
      role: string
      plan_code: string
      server_count: number
      member_count: number
    }>(
      `SELECT w.id, w.name_ciphertext, w.slug, wm.role, COALESCE(s.plan_code, 'community') AS plan_code,
        (SELECT count(*)::int FROM server_connections sc WHERE sc.workspace_id = w.id) AS server_count,
        (SELECT count(*)::int FROM workspace_members m WHERE m.workspace_id = w.id) AS member_count
       FROM workspaces w
       JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = $2
       LEFT JOIN subscriptions s ON s.workspace_id = w.id AND s.status IN ('active', 'trialing')
       WHERE w.id = $1`,
      [request.auth.workspaceId, request.auth.userId]
    )
    const row = result.rows[0]
    if (!row) return reply.code(404).send({ error: 'workspace_not_found' })
    return {
      id: row.id,
      name: decryptField(row.name_ciphertext, 'workspace.name'),
      slug: row.slug,
      role: row.role,
      plan: PLANS.find((plan) => plan.code === row.plan_code) || PLANS[0],
      usage: { servers: row.server_count, members: row.member_count }
    }
  })

  app.get('/current/members', { preHandler: requireScope('members:manage') }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'unauthorized' })
    const result = await db.query<MemberRow>(
      `SELECT wm.user_id, u.email_ciphertext, u.display_name_ciphertext, wm.role, wm.created_at
       FROM workspace_members wm
       JOIN users u ON u.id = wm.user_id
       WHERE wm.workspace_id = $1
       ORDER BY CASE wm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'operator' THEN 2 ELSE 3 END,
         wm.created_at`,
      [request.auth.workspaceId]
    )
    return { members: result.rows.map(publicMember) }
  })

  app.post('/current/members', { preHandler: requireScope('members:manage') }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'unauthorized' })
    const input = addMemberSchema.safeParse(request.body)
    if (!input.success) return reply.code(400).send({ error: 'validation_error', details: input.error.flatten() })

    const client = await db.connect()
    let member: MemberRow
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 1))', [request.auth.workspaceId])
      const capacity = await client.query<{ current: number; seat_limit: number | null }>(
        `SELECT
           (SELECT count(*)::int FROM workspace_members WHERE workspace_id = $1) AS current,
           NULLIF(p.entitlements->>'seats', '')::int AS seat_limit
         FROM subscriptions s
         JOIN plans p ON p.code = s.plan_code
         WHERE s.workspace_id = $1 AND s.status IN ('active', 'trialing')
         LIMIT 1`,
        [request.auth.workspaceId]
      )
      const usage = capacity.rows[0] || { current: 1, seat_limit: 1 }
      if (usage.seat_limit !== null && usage.current >= usage.seat_limit) {
        await client.query('ROLLBACK')
        return reply.code(402).send({
          error: 'plan_limit_reached',
          message: `Your current plan allows ${usage.seat_limit} workspace seat${usage.seat_limit === 1 ? '' : 's'}.`,
          limit: usage.seat_limit
        })
      }

      const user = await client.query<{
        id: string
        email_ciphertext: string
        display_name_ciphertext: string
      }>(
        `SELECT id, email_ciphertext, display_name_ciphertext
         FROM users
         WHERE email_lookup_hash = $1 AND disabled_at IS NULL`,
        [blindIndex(input.data.email, 'user.email')]
      )
      const target = user.rows[0]
      if (!target) {
        await client.query('ROLLBACK')
        return reply.code(404).send({
          error: 'account_not_found',
          message: 'This person needs a monitc account before they can join the workspace.'
        })
      }
      const inserted = await client.query<{ created_at: Date }>(
        `INSERT INTO workspace_members (workspace_id, user_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING
         RETURNING created_at`,
        [request.auth.workspaceId, target.id, input.data.role]
      )
      if (!inserted.rows[0]) {
        await client.query('ROLLBACK')
        return reply.code(409).send({ error: 'member_exists', message: 'This account is already a workspace member.' })
      }
      member = {
        user_id: target.id,
        email_ciphertext: target.email_ciphertext,
        display_name_ciphertext: target.display_name_ciphertext,
        role: input.data.role,
        created_at: inserted.rows[0].created_at
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }

    await audit({
      workspaceId: request.auth.workspaceId,
      actorUserId: request.auth.userId,
      action: 'workspace.member_added',
      resourceType: 'user',
      resourceId: member.user_id,
      metadata: { role: member.role }
    })
    return reply.code(201).send(publicMember(member))
  })

  app.patch('/current/members/:userId', { preHandler: requireScope('members:manage') }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'unauthorized' })
    const userId = idSchema.safeParse((request.params as { userId?: string }).userId)
    const input = changeRoleSchema.safeParse(request.body)
    if (!userId.success || !input.success) return reply.code(400).send({ error: 'validation_error' })
    const result = await db.query<MemberRow>(
      `UPDATE workspace_members wm SET role = $1
       FROM users u
       WHERE wm.workspace_id = $2 AND wm.user_id = $3 AND wm.user_id = u.id AND wm.role <> 'owner'
       RETURNING wm.user_id, u.email_ciphertext, u.display_name_ciphertext, wm.role, wm.created_at`,
      [input.data.role, request.auth.workspaceId, userId.data]
    )
    const member = result.rows[0]
    if (!member) return reply.code(404).send({ error: 'member_not_found_or_owner' })
    await db.query(
      `UPDATE refresh_sessions SET revoked_at = now()
       WHERE user_id = $1 AND workspace_id = $2 AND revoked_at IS NULL`,
      [userId.data, request.auth.workspaceId]
    )
    await audit({
      workspaceId: request.auth.workspaceId,
      actorUserId: request.auth.userId,
      action: 'workspace.member_role_changed',
      resourceType: 'user',
      resourceId: userId.data,
      metadata: { role: input.data.role }
    })
    return publicMember(member)
  })

  app.delete('/current/members/:userId', { preHandler: requireScope('members:manage') }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'unauthorized' })
    const userId = idSchema.safeParse((request.params as { userId?: string }).userId)
    if (!userId.success) return reply.code(400).send({ error: 'validation_error' })
    if (userId.data === request.auth.userId) {
      return reply.code(400).send({ error: 'self_removal_blocked', message: 'Ask another owner to remove your access.' })
    }
    const result = await db.query(
      `DELETE FROM workspace_members
       WHERE workspace_id = $1 AND user_id = $2 AND role <> 'owner'`,
      [request.auth.workspaceId, userId.data]
    )
    if (!result.rowCount) return reply.code(404).send({ error: 'member_not_found_or_owner' })
    await db.query(
      `UPDATE refresh_sessions SET revoked_at = now()
       WHERE user_id = $1 AND workspace_id = $2 AND revoked_at IS NULL`,
      [userId.data, request.auth.workspaceId]
    )
    await audit({
      workspaceId: request.auth.workspaceId,
      actorUserId: request.auth.userId,
      action: 'workspace.member_removed',
      resourceType: 'user',
      resourceId: userId.data
    })
    return reply.code(204).send()
  })

  app.get('/current/audit', { preHandler: requireScope('workspace:manage') }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'unauthorized' })
    if (!(await hasAuditLog(request.auth.workspaceId))) {
      return reply.code(402).send({ error: 'plan_upgrade_required', capability: 'auditLog' })
    }
    const result = await db.query<{
      id: number
      actor_email_ciphertext: string | null
      action: string
      resource_type: string
      resource_id: string | null
      metadata: Record<string, unknown>
      created_at: Date
    }>(
      `SELECT al.id, u.email_ciphertext AS actor_email_ciphertext, al.action, al.resource_type,
        al.resource_id, al.metadata, al.created_at
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.actor_user_id
       WHERE al.workspace_id = $1
       ORDER BY al.created_at DESC
       LIMIT 200`,
      [request.auth.workspaceId]
    )
    return {
      entries: result.rows.map((row) => ({
        id: row.id,
        actorEmail: row.actor_email_ciphertext
          ? decryptField(row.actor_email_ciphertext, 'user.email')
          : null,
        action: row.action,
        resourceType: row.resource_type,
        resourceId: row.resource_id,
        metadata: row.metadata,
        createdAt: row.created_at.toISOString()
      }))
    }
  })
}
