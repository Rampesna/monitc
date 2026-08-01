import type { FastifyInstance } from 'fastify'
import { PLANS } from '@monitc/shared'
import { z } from 'zod'
import { requirePlatformAdmin } from '../auth/guard.js'
import { db } from '../db/pool.js'
import { decryptField, encryptField } from '../lib/pii.js'
import { audit } from '../services/audit.js'

const idSchema = z.uuid()
const planAssignmentSchema = z.object({
  planCode: z.enum(['community', 'solo', 'team', 'scale']),
  notes: z.string().trim().max(1000).optional()
})
const contactStatusSchema = z.object({
  status: z.enum(['new', 'contacted', 'approved', 'rejected'])
})

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requirePlatformAdmin)

  app.get('/overview', async () => {
    const [counts, serverStates, requests, recentSignups, metricVolume] = await Promise.all([
      db.query<{
        users: number
        workspaces: number
        servers: number
        active_subscriptions: number
      }>(`
        SELECT
          (SELECT count(*)::int FROM users WHERE disabled_at IS NULL) AS users,
          (SELECT count(*)::int FROM workspaces) AS workspaces,
          (SELECT count(*)::int FROM server_connections) AS servers,
          (SELECT count(*)::int FROM subscriptions WHERE status IN ('active', 'trialing', 'grace_period')) AS active_subscriptions
      `),
      db.query<{ status: string; count: number }>(
        'SELECT status, count(*)::int AS count FROM server_connections GROUP BY status'
      ),
      db.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM contact_requests WHERE status IN ('new', 'contacted')`
      ),
      db.query<{ day: string; count: number }>(`
        SELECT to_char(day, 'YYYY-MM-DD') AS day, count(u.id)::int AS count
        FROM generate_series(current_date - interval '13 days', current_date, interval '1 day') day
        LEFT JOIN users u ON u.created_at >= day AND u.created_at < day + interval '1 day'
        GROUP BY day ORDER BY day
      `),
      db.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM system_metric_samples WHERE sampled_at >= now() - interval '24 hours'`
      )
    ])
    return {
      ...counts.rows[0],
      pendingRequests: requests.rows[0]?.count || 0,
      metricSamples24h: metricVolume.rows[0]?.count || 0,
      serverStates: Object.fromEntries(serverStates.rows.map((row) => [row.status, row.count])),
      recentSignups: recentSignups.rows
    }
  })

  app.get('/workspaces', async (request) => {
    const query = z.object({ q: z.string().max(100).default('') }).parse(request.query)
    const result = await db.query<{
      id: string
      name_ciphertext: string
      slug: string
      plan_code: string
      member_count: number
      server_count: number
      owner_email_ciphertext: string | null
      created_at: Date
    }>(
      `SELECT w.id, w.name_ciphertext, w.slug, COALESCE(s.plan_code, 'community') AS plan_code,
        (SELECT count(*)::int FROM workspace_members wm WHERE wm.workspace_id = w.id) AS member_count,
        (SELECT count(*)::int FROM server_connections sc WHERE sc.workspace_id = w.id) AS server_count,
        (SELECT u.email_ciphertext FROM workspace_members wm JOIN users u ON u.id = wm.user_id
          WHERE wm.workspace_id = w.id AND wm.role = 'owner' ORDER BY wm.created_at LIMIT 1) AS owner_email_ciphertext,
        w.created_at
       FROM workspaces w
       LEFT JOIN subscriptions s ON s.workspace_id = w.id AND s.status IN ('active', 'trialing', 'grace_period')
       ORDER BY w.created_at DESC LIMIT 500`
    )
    const needle = query.q.trim().toLocaleLowerCase('en-US')
    const decrypted = result.rows.map((row) => ({
      id: row.id,
      name: decryptField(row.name_ciphertext, 'workspace.name'),
      slug: row.slug,
      planCode: row.plan_code,
      memberCount: row.member_count,
      serverCount: row.server_count,
      ownerEmail: row.owner_email_ciphertext
        ? decryptField(row.owner_email_ciphertext, 'user.email')
        : null,
      createdAt: row.created_at.toISOString()
    }))
    return {
      workspaces: decrypted
        .filter((row) => !needle || [row.name, row.slug, row.ownerEmail || '']
          .some((value) => value.toLocaleLowerCase('en-US').includes(needle)))
        .slice(0, 200)
    }
  })

  app.patch('/workspaces/:id/plan', async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'unauthorized' })
    const id = idSchema.safeParse((request.params as { id?: string }).id)
    const input = planAssignmentSchema.safeParse(request.body)
    if (!id.success || !input.success) return reply.code(400).send({ error: 'validation_error' })
    const result = await db.query<{ workspace_id: string }>(
      `INSERT INTO subscriptions
        (workspace_id, plan_code, status, source, assigned_by, notes_ciphertext)
       SELECT id, $2, 'active', 'manual', $3, $4
       FROM workspaces
       WHERE id = $1
       ON CONFLICT (workspace_id) DO UPDATE SET
         plan_code = EXCLUDED.plan_code,
         status = 'active',
         source = 'manual',
         assigned_by = EXCLUDED.assigned_by,
         notes_ciphertext = EXCLUDED.notes_ciphertext,
         updated_at = now()
       RETURNING workspace_id`,
      [
        id.data,
        input.data.planCode,
        request.auth.userId,
        input.data.notes ? encryptField(input.data.notes, 'subscription.notes') : null
      ]
    )
    if (!result.rows[0]) return reply.code(404).send({ error: 'workspace_not_found' })
    await audit({
      workspaceId: id.data,
      actorUserId: request.auth.userId,
      action: 'subscription.plan_assigned',
      resourceType: 'plan',
      resourceId: input.data.planCode,
      metadata: { source: 'manual' }
    })
    return { ok: true, plan: PLANS.find((plan) => plan.code === input.data.planCode) }
  })

  app.get('/users', async (request) => {
    const query = z.object({ q: z.string().max(100).default('') }).parse(request.query)
    const result = await db.query<{
      id: string
      email_ciphertext: string
      display_name_ciphertext: string
      global_role: string
      disabled_at: Date | null
      last_login_at: Date | null
      created_at: Date
      workspace_count: number
    }>(
      `SELECT u.id, u.email_ciphertext, u.display_name_ciphertext, u.global_role,
        u.disabled_at, u.last_login_at, u.created_at,
        (SELECT count(*)::int FROM workspace_members wm WHERE wm.user_id = u.id) AS workspace_count
       FROM users u
       ORDER BY u.created_at DESC LIMIT 500`
    )
    const needle = query.q.trim().toLocaleLowerCase('en-US')
    const decrypted = result.rows.map((row) => ({
      id: row.id,
      email: decryptField(row.email_ciphertext, 'user.email'),
      displayName: decryptField(row.display_name_ciphertext, 'user.displayName'),
      globalRole: row.global_role,
      disabled: Boolean(row.disabled_at),
      lastLoginAt: row.last_login_at?.toISOString() || null,
      createdAt: row.created_at.toISOString(),
      workspaceCount: row.workspace_count
    }))
    return {
      users: decrypted
        .filter((row) => !needle || [row.email, row.displayName]
          .some((value) => value.toLocaleLowerCase('en-US').includes(needle)))
        .slice(0, 200)
    }
  })

  app.get('/contact-requests', async () => {
    const result = await db.query<{
      id: string
      workspace_id: string
      workspace_name_ciphertext: string
      email_ciphertext: string
      requested_plan_code: string
      message_ciphertext: string | null
      status: string
      created_at: Date
    }>(`
      SELECT cr.id, cr.workspace_id, w.name_ciphertext AS workspace_name_ciphertext,
        u.email_ciphertext, cr.requested_plan_code, cr.message_ciphertext, cr.status, cr.created_at
      FROM contact_requests cr
      JOIN workspaces w ON w.id = cr.workspace_id
      JOIN users u ON u.id = cr.user_id
      ORDER BY CASE cr.status WHEN 'new' THEN 0 WHEN 'contacted' THEN 1 ELSE 2 END, cr.created_at DESC
      LIMIT 300
    `)
    return {
      requests: result.rows.map((row) => ({
        id: row.id,
        workspaceId: row.workspace_id,
        workspaceName: decryptField(row.workspace_name_ciphertext, 'workspace.name'),
        email: decryptField(row.email_ciphertext, 'user.email'),
        planCode: row.requested_plan_code,
        message: row.message_ciphertext
          ? decryptField(row.message_ciphertext, 'contact.message')
          : null,
        status: row.status,
        createdAt: row.created_at.toISOString()
      }))
    }
  })

  app.patch('/contact-requests/:id', async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'unauthorized' })
    const id = idSchema.safeParse((request.params as { id?: string }).id)
    const input = contactStatusSchema.safeParse(request.body)
    if (!id.success || !input.success) return reply.code(400).send({ error: 'validation_error' })
    const result = await db.query<{ workspace_id: string }>(
      `UPDATE contact_requests SET status = $1, handled_by = $2, handled_at = now()
       WHERE id = $3 RETURNING workspace_id`,
      [input.data.status, request.auth.userId, id.data]
    )
    if (!result.rows[0]) return reply.code(404).send({ error: 'request_not_found' })
    await audit({
      workspaceId: result.rows[0].workspace_id,
      actorUserId: request.auth.userId,
      action: 'billing.contact_status_changed',
      resourceType: 'contact_request',
      resourceId: id.data,
      metadata: { status: input.data.status }
    })
    return { ok: true }
  })

  app.get('/audit', async () => {
    const result = await db.query<{
      id: number
      workspace_id: string | null
      actor_email_ciphertext: string | null
      action: string
      resource_type: string
      resource_id: string | null
      metadata: Record<string, unknown>
      created_at: Date
    }>(`
      SELECT al.id, al.workspace_id, u.email_ciphertext AS actor_email_ciphertext,
        al.action, al.resource_type,
        al.resource_id, al.metadata, al.created_at
      FROM audit_logs al
      LEFT JOIN users u ON u.id = al.actor_user_id
      ORDER BY al.created_at DESC LIMIT 300
    `)
    return {
      entries: result.rows.map((row) => ({
        id: row.id,
        workspaceId: row.workspace_id,
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
