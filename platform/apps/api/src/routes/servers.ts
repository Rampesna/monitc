import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireScope } from '../auth/guard.js'
import { db } from '../db/pool.js'
import { decryptField, encryptField } from '../lib/pii.js'
import { decryptVaultSecret, encryptVaultSecret } from '../lib/vault.js'
import { collectServer } from '../services/ssh-collector.js'
import { audit } from '../services/audit.js'

const encryptedSecretSchema = z.object({
  keyId: z.string().min(1).max(100),
  ciphertext: z.string().min(64).max(200_000)
})

const createServerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  connectionMode: z.enum(['ssh', 'agent']).default('ssh'),
  encryptedSecret: encryptedSecretSchema
})

const updateServerSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  encryptedSecret: encryptedSecretSchema.optional()
})

const idSchema = z.uuid()

interface ServerRow {
  id: string
  name_ciphertext: string
  connection_mode: 'ssh' | 'agent'
  secret_ciphertext: string
  secret_key_id: string
  status: 'pending' | 'connected' | 'degraded' | 'offline'
  last_seen_at: Date | null
  created_at: Date
}

async function publicServer(row: ServerRow) {
  let metadata: { host?: string; port?: number; username?: string } = {}
  try {
    const secret = await decryptVaultSecret(row.secret_ciphertext, row.secret_key_id)
    metadata = { host: secret.host, port: secret.port, username: secret.username }
  } catch {
    // Key rotation or damaged ciphertext must never leak into a 500 response.
  }
  return {
    id: row.id,
    name: decryptField(row.name_ciphertext, 'server.name'),
    connectionMode: row.connection_mode,
    status: row.status,
    ...metadata,
    lastSeenAt: row.last_seen_at?.toISOString() || null,
    createdAt: row.created_at.toISOString()
  }
}

function connectionErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (message.includes('Authentication')) return 'SSH_AUTH_FAILED'
  if (message.includes('fingerprint') || message.includes('Host denied')) return 'SSH_HOST_KEY_FAILED'
  if (message.includes('TIMEOUT') || message.includes('timed out')) return 'SSH_TIMEOUT'
  if (message.includes('PRIVATE_TARGET') || message.includes('TARGET_NOT_ALLOWED')) return 'TARGET_POLICY_BLOCKED'
  if (message.includes('ECONNREFUSED')) return 'SSH_REFUSED'
  return 'CONNECTION_FAILED'
}

export async function serverRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: requireScope('servers:read') }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'unauthorized' })
    const result = await db.query<ServerRow>(
      `SELECT id, name_ciphertext, connection_mode, secret_ciphertext, secret_key_id, status, last_seen_at, created_at
       FROM server_connections WHERE workspace_id = $1 ORDER BY created_at DESC`,
      [request.auth.workspaceId]
    )
    return { servers: await Promise.all(result.rows.map(publicServer)) }
  })

  app.post('/', { preHandler: requireScope('servers:write') }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'unauthorized' })
    const parsed = createServerSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error', details: parsed.error.flatten() })

    // Validate the ciphertext before persisting it. Plaintext exists only in this request's memory.
    await decryptVaultSecret(parsed.data.encryptedSecret.ciphertext, parsed.data.encryptedSecret.keyId)
    const client = await db.connect()
    let row: ServerRow
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [request.auth.workspaceId])
      const usageResult = await client.query<{ current: number; server_limit: number | null }>(
        `SELECT
           (SELECT count(*)::int FROM server_connections WHERE workspace_id = $1) AS current,
           NULLIF(p.entitlements->>'servers', '')::int AS server_limit
         FROM subscriptions s
         JOIN plans p ON p.code = s.plan_code
         WHERE s.workspace_id = $1 AND s.status IN ('active', 'trialing')
         LIMIT 1`,
        [request.auth.workspaceId]
      )
      const usage = usageResult.rows[0] || { current: 0, server_limit: 2 }
      if (usage.server_limit !== null && usage.current >= usage.server_limit) {
        await client.query('ROLLBACK')
        return reply.code(402).send({
          error: 'plan_limit_reached',
          message: `Your current plan allows ${usage.server_limit} servers.`,
          limit: usage.server_limit
        })
      }

      const result = await client.query<ServerRow>(
        `INSERT INTO server_connections
          (workspace_id, name_ciphertext, connection_mode, secret_ciphertext, secret_key_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, name_ciphertext, connection_mode, secret_ciphertext, secret_key_id, status, last_seen_at, created_at`,
        [
          request.auth.workspaceId,
          encryptField(parsed.data.name, 'server.name'),
          parsed.data.connectionMode,
          parsed.data.encryptedSecret.ciphertext,
          parsed.data.encryptedSecret.keyId,
          request.auth.userId
        ]
      )
      row = result.rows[0]!
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
      action: 'server.created',
      resourceType: 'server',
      resourceId: row.id,
      metadata: { connectionMode: row.connection_mode }
    })
    return reply.code(201).send(await publicServer(row))
  })

  app.patch('/:id', { preHandler: requireScope('servers:write') }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'unauthorized' })
    const id = idSchema.safeParse((request.params as { id?: string }).id)
    const input = updateServerSchema.safeParse(request.body)
    if (!id.success || !input.success) return reply.code(400).send({ error: 'validation_error' })
    if (input.data.encryptedSecret) {
      await decryptVaultSecret(input.data.encryptedSecret.ciphertext, input.data.encryptedSecret.keyId)
    }
    const result = await db.query<ServerRow>(
      `UPDATE server_connections SET
         name_ciphertext = COALESCE($1, name_ciphertext),
         secret_ciphertext = COALESCE($2, secret_ciphertext),
         secret_key_id = COALESCE($3, secret_key_id),
         updated_at = now()
       WHERE id = $4 AND workspace_id = $5
       RETURNING id, name_ciphertext, connection_mode, secret_ciphertext, secret_key_id, status, last_seen_at, created_at`,
      [
        input.data.name ? encryptField(input.data.name, 'server.name') : null,
        input.data.encryptedSecret?.ciphertext || null,
        input.data.encryptedSecret?.keyId || null,
        id.data,
        request.auth.workspaceId
      ]
    )
    if (!result.rows[0]) return reply.code(404).send({ error: 'server_not_found' })
    await audit({
      workspaceId: request.auth.workspaceId,
      actorUserId: request.auth.userId,
      action: 'server.updated',
      resourceType: 'server',
      resourceId: id.data
    })
    return publicServer(result.rows[0])
  })

  app.delete('/:id', { preHandler: requireScope('servers:write') }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'unauthorized' })
    const id = idSchema.safeParse((request.params as { id?: string }).id)
    if (!id.success) return reply.code(400).send({ error: 'validation_error' })
    const result = await db.query(
      'DELETE FROM server_connections WHERE id = $1 AND workspace_id = $2',
      [id.data, request.auth.workspaceId]
    )
    if (!result.rowCount) return reply.code(404).send({ error: 'server_not_found' })
    await audit({
      workspaceId: request.auth.workspaceId,
      actorUserId: request.auth.userId,
      action: 'server.deleted',
      resourceType: 'server',
      resourceId: id.data
    })
    return reply.code(204).send()
  })

  app.post('/:id/test', { preHandler: requireScope('servers:operate') }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'unauthorized' })
    const id = idSchema.safeParse((request.params as { id?: string }).id)
    if (!id.success) return reply.code(400).send({ error: 'validation_error' })
    const result = await db.query<ServerRow>(
      `SELECT id, name_ciphertext, connection_mode, secret_ciphertext, secret_key_id, status, last_seen_at, created_at
       FROM server_connections WHERE id = $1 AND workspace_id = $2`,
      [id.data, request.auth.workspaceId]
    )
    const row = result.rows[0]
    if (!row) return reply.code(404).send({ error: 'server_not_found' })
    try {
      const secret = await decryptVaultSecret(row.secret_ciphertext, row.secret_key_id)
      const snapshot = await collectServer(secret)
      let ciphertext = row.secret_ciphertext
      if (!secret.hostFingerprint) {
        secret.hostFingerprint = snapshot.fingerprint
        ciphertext = await encryptVaultSecret(secret)
      }
      await db.query(
        `UPDATE server_connections SET
           secret_ciphertext = $1,
           status = 'connected',
           last_seen_at = now(),
           last_error_code = NULL,
           last_error_at = NULL,
           updated_at = now()
         WHERE id = $2`,
        [ciphertext, row.id]
      )
      return {
        ok: true,
        fingerprint: snapshot.fingerprint,
        system: snapshot.system,
        kubernetesPods: snapshot.pods.length
      }
    } catch (error) {
      const code = connectionErrorCode(error)
      request.log.warn({ serverId: row.id, code }, 'server connection test failed')
      await db.query(
        `UPDATE server_connections SET
           status = 'degraded',
           last_error_code = $1,
           last_error_at = now(),
           updated_at = now()
         WHERE id = $2 AND workspace_id = $3`,
        [code, row.id, request.auth.workspaceId]
      )
      return reply.code(422).send({ error: 'connection_failed', code })
    }
  })
}
