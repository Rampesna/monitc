import { createHash, randomBytes } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireScope } from '../auth/guard.js'
import { db } from '../db/pool.js'
import { decryptField, encryptField } from '../lib/pii.js'
import { decryptVaultSecret, encryptVaultSecret } from '../lib/vault.js'
import { audit } from '../services/audit.js'
import { config } from '../config.js'
import { resolveServerProvider } from '../providers/registry.js'
import { SshConnection } from '../services/ssh-collector.js'

const encryptedSecretSchema = z.object({
  keyId: z.string().min(1).max(100),
  ciphertext: z.string().min(64).max(200_000)
})

const createServerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  connectionMode: z.enum(['ssh', 'agent']).default('ssh'),
  encryptedSecret: encryptedSecretSchema.optional()
}).superRefine((value, context) => {
  if (value.connectionMode === 'ssh' && !value.encryptedSecret) {
    context.addIssue({ code: 'custom', path: ['encryptedSecret'], message: 'SSH credentials are required.' })
  }
})

const updateServerSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  encryptedSecret: encryptedSecretSchema.optional()
})

const idSchema = z.uuid()

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

interface ServerRow {
  id: string
  name_ciphertext: string
  connection_mode: 'ssh' | 'agent'
  secret_ciphertext: string | null
  secret_key_id: string | null
  status: 'pending' | 'connected' | 'degraded' | 'offline'
  last_seen_at: Date | null
  created_at: Date
  agent_id?: string | null
  agent_status?: 'paired' | 'connected' | 'degraded' | 'offline' | 'revoked' | null
  agent_version?: string | null
  agent_operating_system?: string | null
  agent_architecture?: string | null
  agent_kernel_version?: string | null
  agent_capabilities?: string[] | null
  agent_enabled_capabilities?: string[] | null
  agent_ebpf_active?: boolean | null
  agent_last_seen_at?: Date | null
  agent_last_heartbeat_at?: Date | null
  agent_certificate_expires_at?: Date | null
  agent_spool_bytes?: number | null
  agent_spool_batches?: number | null
}

async function publicServer(row: ServerRow) {
  let metadata: { host?: string; port?: number; username?: string } = {}
  try {
    if (row.secret_ciphertext && row.secret_key_id) {
      const secret = await decryptVaultSecret(row.secret_ciphertext, row.secret_key_id)
      metadata = { host: secret.host, port: secret.port, username: secret.username }
    }
  } catch {
    // Key rotation or damaged ciphertext must never leak into a 500 response.
  }
  return {
    id: row.id,
    name: decryptField(row.name_ciphertext, 'server.name'),
    connectionMode: row.connection_mode,
    status: row.status,
    ...metadata,
    sshFallbackConfigured: Boolean(row.secret_ciphertext && row.secret_key_id),
    agent: row.agent_id && row.agent_status && row.agent_certificate_expires_at ? {
      id: row.agent_id,
      status: row.agent_status,
      version: row.agent_version || '',
      operatingSystem: row.agent_operating_system || '',
      architecture: row.agent_architecture || '',
      kernelVersion: row.agent_kernel_version || '',
      capabilities: row.agent_capabilities || [],
      enabledCapabilities: row.agent_enabled_capabilities || [],
      ebpfActive: Boolean(row.agent_ebpf_active),
      lastSeenAt: row.agent_last_seen_at?.toISOString() || null,
      lastHeartbeatAt: row.agent_last_heartbeat_at?.toISOString() || null,
      certificateExpiresAt: row.agent_certificate_expires_at.toISOString(),
      spoolBytes: Number(row.agent_spool_bytes || 0),
      spoolBatches: Number(row.agent_spool_batches || 0)
    } : undefined,
    lastSeenAt: row.last_seen_at?.toISOString() || null,
    createdAt: row.created_at.toISOString()
  }
}

function connectionErrorCode(error: unknown): string {
  const message = (error instanceof Error ? error.message : '').toLowerCase()
  if (message.includes('authentication')) return 'SSH_AUTH_FAILED'
  if (message.includes('fingerprint') || message.includes('host denied')) return 'SSH_HOST_KEY_FAILED'
  if (message.includes('timeout') || message.includes('timed out')) return 'SSH_TIMEOUT'
  if (message.includes('private_target') || message.includes('target_not_allowed')) return 'TARGET_POLICY_BLOCKED'
  if (message.includes('econnrefused')) return 'SSH_REFUSED'
  return 'CONNECTION_FAILED'
}

export async function serverRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: requireScope('servers:read') }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'unauthorized' })
    const result = await db.query<ServerRow>(
      `SELECT server.id, server.name_ciphertext, server.connection_mode, server.secret_ciphertext,
         server.secret_key_id, server.status, server.last_seen_at, server.created_at,
         agent.id AS agent_id, agent.status AS agent_status, agent.agent_version,
         agent.operating_system AS agent_operating_system, agent.architecture AS agent_architecture,
         agent.kernel_version AS agent_kernel_version, agent.capabilities AS agent_capabilities,
         agent.enabled_capabilities AS agent_enabled_capabilities, agent.ebpf_active AS agent_ebpf_active,
         agent.last_seen_at AS agent_last_seen_at, agent.last_heartbeat_at AS agent_last_heartbeat_at,
         agent.certificate_expires_at AS agent_certificate_expires_at,
         agent.spool_bytes AS agent_spool_bytes, agent.spool_batches AS agent_spool_batches
       FROM server_connections server
       LEFT JOIN agent_identities agent ON agent.server_id = server.id
       WHERE server.workspace_id = $1 ORDER BY server.created_at DESC`,
      [request.auth.workspaceId]
    )
    return { servers: await Promise.all(result.rows.map(publicServer)) }
  })

  app.post('/', { preHandler: requireScope('servers:write') }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'unauthorized' })
    const parsed = createServerSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error', details: parsed.error.flatten() })

    // Validate the ciphertext before persisting it. Plaintext exists only in this request's memory.
    if (parsed.data.encryptedSecret) {
      await decryptVaultSecret(parsed.data.encryptedSecret.ciphertext, parsed.data.encryptedSecret.keyId)
    }
    const client = await db.connect()
    let row: ServerRow
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [request.auth.workspaceId])
      const usageResult = await client.query<{ current: number; server_limit: number | null; agent_mode: boolean }>(
        `SELECT
           (SELECT count(*)::int FROM server_connections WHERE workspace_id = $1) AS current,
           NULLIF(p.entitlements->>'servers', '')::int AS server_limit,
           COALESCE((p.entitlements->>'agentMode')::boolean, false) AS agent_mode
         FROM subscriptions s
         JOIN plans p ON p.code = s.plan_code
         WHERE s.workspace_id = $1 AND s.status IN ('active', 'trialing', 'grace_period')
         LIMIT 1`,
        [request.auth.workspaceId]
      )
      const usage = usageResult.rows[0] || { current: 0, server_limit: 2, agent_mode: false }
      if (usage.server_limit !== null && usage.current >= usage.server_limit) {
        await client.query('ROLLBACK')
        return reply.code(402).send({
          error: 'plan_limit_reached',
          message: `Your current plan allows ${usage.server_limit} servers.`,
          limit: usage.server_limit
        })
      }
      if (parsed.data.connectionMode === 'agent' && !usage.agent_mode) {
        await client.query('ROLLBACK')
        return reply.code(402).send({ error: 'plan_upgrade_required', capability: 'agentMode' })
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
          parsed.data.encryptedSecret?.ciphertext || null,
          parsed.data.encryptedSecret?.keyId || null,
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
      resourceId: id.data,
      metadata: {
        nameChanged: Boolean(input.data.name),
        sshFallbackConfigured: Boolean(input.data.encryptedSecret)
      }
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

  app.post('/:id/ssh/test', { preHandler: requireScope('servers:operate') }, async (request, reply) => {
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
    if (!row.secret_ciphertext || !row.secret_key_id) {
      return reply.code(409).send({ error: 'ssh_fallback_not_configured' })
    }

    try {
      const secret = await decryptVaultSecret(row.secret_ciphertext, row.secret_key_id)
      const connection = await SshConnection.connect(secret)
      let fingerprint = ''
      try {
        fingerprint = await connection.fingerprint
        await connection.sftp()
      } finally {
        connection.close()
      }
      const rotatedSecretCiphertext = secret.hostFingerprint
        ? null
        : await encryptVaultSecret({ ...secret, hostFingerprint: fingerprint })
      await db.query(
        `UPDATE server_connections SET
           secret_ciphertext = COALESCE($1, secret_ciphertext),
           last_error_code = NULL, last_error_at = NULL, updated_at = now()
         WHERE id = $2 AND workspace_id = $3`,
        [rotatedSecretCiphertext, row.id, request.auth.workspaceId]
      )
      await audit({
        workspaceId: request.auth.workspaceId,
        actorUserId: request.auth.userId,
        action: 'server.ssh_fallback_verified',
        resourceType: 'server',
        resourceId: row.id
      })
      return { ok: true, fingerprint, sftp: true }
    } catch (error) {
      const code = connectionErrorCode(error)
      request.log.warn({ serverId: row.id, code }, 'SSH fallback verification failed')
      await db.query(
        `UPDATE server_connections SET last_error_code = $1, last_error_at = now(), updated_at = now()
         WHERE id = $2 AND workspace_id = $3`,
        [code, row.id, request.auth.workspaceId]
      )
      return reply.code(422).send({ error: 'connection_failed', code })
    }
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
    const provider = resolveServerProvider(row, request.auth.workspaceId)
    try {
      const providerResult = await provider.testConnection()
      await db.query(
        `UPDATE server_connections SET
           secret_ciphertext = COALESCE($1, secret_ciphertext),
           status = $2,
           last_seen_at = CASE WHEN $2 = 'connected' THEN now() ELSE last_seen_at END,
           last_error_code = CASE WHEN $2 = 'connected' THEN NULL ELSE last_error_code END,
           last_error_at = CASE WHEN $2 = 'connected' THEN NULL ELSE last_error_at END,
           updated_at = now()
         WHERE id = $3 AND workspace_id = $4`,
        [
          providerResult.rotatedSecretCiphertext || null,
          providerResult.status,
          row.id,
          request.auth.workspaceId
        ]
      )
      return providerResult
    } catch (error) {
      if ((error as Error & { statusCode?: number }).statusCode === 409) {
        return reply.code(409).send({ error: 'ssh_fallback_not_configured' })
      }
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

  app.post('/:id/agent/pairing-token', { preHandler: requireScope('servers:write') }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'unauthorized' })
    const id = idSchema.safeParse((request.params as { id?: string }).id)
    if (!id.success) return reply.code(400).send({ error: 'validation_error' })
    const server = await db.query<{ id: string }>(
      `SELECT id FROM server_connections
       WHERE id = $1 AND workspace_id = $2 AND connection_mode = 'agent'`,
      [id.data, request.auth.workspaceId]
    )
    if (!server.rowCount) return reply.code(404).send({ error: 'agent_server_not_found' })

    const token = randomBytes(32).toString('base64url')
    const tokenHash = createHash('sha256').update(token).digest()
    const tokenHint = token.slice(-6)
    const expiresAt = new Date(Date.now() + 15 * 60_000)
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `UPDATE agent_pairing_tokens SET revoked_at = now()
         WHERE server_id = $1 AND used_at IS NULL AND revoked_at IS NULL`,
        [id.data]
      )
      await client.query(
        `INSERT INTO agent_pairing_tokens
          (workspace_id, server_id, token_hash, token_hint, expires_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [request.auth.workspaceId, id.data, tokenHash, tokenHint, expiresAt, request.auth.userId]
      )
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
      action: 'agent.pairing_token.created',
      resourceType: 'server',
      resourceId: id.data,
      metadata: { expiresAt: expiresAt.toISOString(), tokenHint }
    })
    return reply.code(201).send({
      token,
      expiresAt: expiresAt.toISOString(),
      gatewayAddress: config.AGENT_GATEWAY_PUBLIC_ADDRESS,
      gatewayServerName: config.AGENT_GATEWAY_SERVER_NAME,
      bootstrapCAUrl: `${config.API_ORIGIN}/api/v1/agent/bootstrap-ca`,
      installCommand: `curl -fsSL ${shellQuote(config.AGENT_INSTALL_URL)} | sudo env ` +
        `MONITC_AGENT_GATEWAY=${shellQuote(config.AGENT_GATEWAY_PUBLIC_ADDRESS)} ` +
        `MONITC_AGENT_SERVER_NAME=${shellQuote(config.AGENT_GATEWAY_SERVER_NAME)} bash`
    })
  })
}
