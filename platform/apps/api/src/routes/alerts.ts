import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireScope } from '../auth/guard.js'
import { db } from '../db/pool.js'
import { decryptField, encryptField } from '../lib/pii.js'
import { audit } from '../services/audit.js'

const idSchema = z.uuid()
const ruleSchema = z.object({
  name: z.string().trim().min(2).max(100),
  serverId: z.uuid().nullable().optional(),
  metric: z.enum(['cpu', 'memory', 'disk', 'network_rx', 'network_tx']),
  operator: z.enum(['gt', 'gte', 'lt', 'lte', 'eq']).default('gte'),
  threshold: z.number().finite().min(0),
  durationSeconds: z.number().int().min(0).max(86_400).default(60),
  cooldownSeconds: z.number().int().min(60).max(604_800).default(900),
  enabled: z.boolean().default(true)
})
const updateSchema = ruleSchema.partial()

interface RuleRow {
  id: string
  name_ciphertext: string
  server_id: string | null
  server_name_ciphertext: string | null
  metric: string
  operator: string
  threshold: number
  duration_seconds: number
  cooldown_seconds: number
  enabled: boolean
  created_at: Date
}

async function alertsEnabled(workspaceId: string): Promise<boolean> {
  const result = await db.query<{ enabled: boolean }>(
    `SELECT COALESCE((p.entitlements->>'alerts')::boolean, false) AS enabled
     FROM subscriptions s JOIN plans p ON p.code = s.plan_code
     WHERE s.workspace_id = $1 AND s.status IN ('active', 'trialing', 'grace_period')`,
    [workspaceId]
  )
  return result.rows[0]?.enabled || false
}

function publicRule(row: RuleRow) {
  return {
    id: row.id,
    name: decryptField(row.name_ciphertext, 'alert.name'),
    serverId: row.server_id,
    metric: row.metric,
    operator: row.operator,
    threshold: row.threshold,
    durationSeconds: row.duration_seconds,
    cooldownSeconds: row.cooldown_seconds,
    enabled: row.enabled,
    createdAt: row.created_at.toISOString()
  }
}

export async function alertRoutes(app: FastifyInstance): Promise<void> {
  app.get('/rules', { preHandler: requireScope('metrics:read') }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'unauthorized' })
    const result = await db.query<RuleRow>(
      `SELECT ar.id, ar.name_ciphertext, ar.server_id, sc.name_ciphertext AS server_name_ciphertext,
        ar.metric, ar.operator, ar.threshold, ar.duration_seconds, ar.cooldown_seconds,
        ar.enabled, ar.created_at
       FROM alert_rules ar
       LEFT JOIN server_connections sc ON sc.id = ar.server_id
       WHERE ar.workspace_id = $1 ORDER BY ar.created_at DESC`,
      [request.auth.workspaceId]
    )
    return {
      enabledByPlan: await alertsEnabled(request.auth.workspaceId),
      rules: result.rows.map(publicRule)
    }
  })

  app.post('/rules', { preHandler: requireScope('alerts:manage') }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'unauthorized' })
    if (!(await alertsEnabled(request.auth.workspaceId))) {
      return reply.code(402).send({ error: 'plan_upgrade_required', capability: 'alerts' })
    }
    const input = ruleSchema.safeParse(request.body)
    if (!input.success) return reply.code(400).send({ error: 'validation_error', details: input.error.flatten() })
    if (input.data.serverId) {
      const server = await db.query(
        'SELECT 1 FROM server_connections WHERE id = $1 AND workspace_id = $2',
        [input.data.serverId, request.auth.workspaceId]
      )
      if (!server.rowCount) return reply.code(404).send({ error: 'server_not_found' })
    }
    const result = await db.query<RuleRow>(
      `INSERT INTO alert_rules
        (workspace_id, server_id, name_ciphertext, metric, operator, threshold,
         duration_seconds, cooldown_seconds, enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, name_ciphertext, server_id, NULL::text AS server_name_ciphertext, metric, operator,
         threshold, duration_seconds, cooldown_seconds, enabled, created_at`,
      [
        request.auth.workspaceId,
        input.data.serverId || null,
        encryptField(input.data.name, 'alert.name'),
        input.data.metric,
        input.data.operator,
        input.data.threshold,
        input.data.durationSeconds,
        input.data.cooldownSeconds,
        input.data.enabled
      ]
    )
    await audit({
      workspaceId: request.auth.workspaceId,
      actorUserId: request.auth.userId,
      action: 'alert_rule.created',
      resourceType: 'alert_rule',
      resourceId: result.rows[0]!.id
    })
    return reply.code(201).send(publicRule(result.rows[0]!))
  })

  app.patch('/rules/:id', { preHandler: requireScope('alerts:manage') }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'unauthorized' })
    const id = idSchema.safeParse((request.params as { id?: string }).id)
    const input = updateSchema.safeParse(request.body)
    if (!id.success || !input.success) return reply.code(400).send({ error: 'validation_error' })
    if (!(await alertsEnabled(request.auth.workspaceId))) {
      return reply.code(402).send({ error: 'plan_upgrade_required', capability: 'alerts' })
    }
    const current = await db.query<RuleRow>(
      `SELECT id, name_ciphertext, server_id, NULL::text AS server_name_ciphertext, metric, operator,
        threshold, duration_seconds, cooldown_seconds, enabled, created_at
       FROM alert_rules WHERE id = $1 AND workspace_id = $2`,
      [id.data, request.auth.workspaceId]
    )
    const rule = current.rows[0]
    if (!rule) return reply.code(404).send({ error: 'alert_rule_not_found' })
    if (input.data.serverId) {
      const server = await db.query(
        'SELECT 1 FROM server_connections WHERE id = $1 AND workspace_id = $2',
        [input.data.serverId, request.auth.workspaceId]
      )
      if (!server.rowCount) return reply.code(404).send({ error: 'server_not_found' })
    }
    const next = { ...publicRule(rule), ...input.data }
    const result = await db.query<RuleRow>(
      `UPDATE alert_rules SET
        name_ciphertext = $1, server_id = $2, metric = $3, operator = $4, threshold = $5,
        duration_seconds = $6, cooldown_seconds = $7, enabled = $8, updated_at = now()
       WHERE id = $9 AND workspace_id = $10
       RETURNING id, name_ciphertext, server_id, NULL::text AS server_name_ciphertext, metric, operator,
         threshold, duration_seconds, cooldown_seconds, enabled, created_at`,
      [
        encryptField(next.name, 'alert.name'),
        next.serverId || null,
        next.metric,
        next.operator,
        next.threshold,
        next.durationSeconds,
        next.cooldownSeconds,
        next.enabled,
        id.data,
        request.auth.workspaceId
      ]
    )
    return publicRule(result.rows[0]!)
  })

  app.delete('/rules/:id', { preHandler: requireScope('alerts:manage') }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'unauthorized' })
    const id = idSchema.safeParse((request.params as { id?: string }).id)
    if (!id.success) return reply.code(400).send({ error: 'validation_error' })
    const result = await db.query(
      'DELETE FROM alert_rules WHERE id = $1 AND workspace_id = $2',
      [id.data, request.auth.workspaceId]
    )
    if (!result.rowCount) return reply.code(404).send({ error: 'alert_rule_not_found' })
    return reply.code(204).send()
  })

  app.get('/events', { preHandler: requireScope('metrics:read') }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'unauthorized' })
    const result = await db.query<{
      id: string
      rule_name_ciphertext: string
      server_id: string
      value: number
      status: 'open' | 'resolved'
      triggered_at: Date
      resolved_at: Date | null
    }>(
      `SELECT ae.id, ar.name_ciphertext AS rule_name_ciphertext, ae.server_id, ae.value, ae.status,
        ae.triggered_at, ae.resolved_at
       FROM alert_events ae JOIN alert_rules ar ON ar.id = ae.rule_id
       WHERE ae.workspace_id = $1 ORDER BY ae.triggered_at DESC LIMIT 100`,
      [request.auth.workspaceId]
    )
    return {
      events: result.rows.map((row) => ({
        id: row.id,
        ruleName: decryptField(row.rule_name_ciphertext, 'alert.name'),
        serverId: row.server_id,
        value: row.value,
        status: row.status,
        triggeredAt: row.triggered_at.toISOString(),
        resolvedAt: row.resolved_at?.toISOString() || null
      }))
    }
  })
}
