import { randomUUID } from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import type { AuthSession, GlobalRole, PlanDefinition, PublicUser, WorkspaceRole, WorkspaceSummary } from '@monitc/shared'
import { PLANS } from '@monitc/shared'
import { config } from '../config.js'
import { db } from '../db/pool.js'
import { decryptField } from '../lib/pii.js'
import { hashMetadata, hashRefreshToken, issueAccessToken, newRefreshToken } from '../lib/tokens.js'
import { scopesFor } from './scopes.js'

interface SessionSubjectRow {
  user_id: string
  email: string
  display_name: string
  global_role: GlobalRole
  must_change_password: boolean
  workspace_id: string
  workspace_name: string
  workspace_slug: string
  workspace_role: WorkspaceRole
  plan_code: string
}

interface EncryptedSessionSubjectRow {
  user_id: string
  email_ciphertext: string
  display_name_ciphertext: string
  global_role: GlobalRole
  must_change_password: boolean
  workspace_id: string
  workspace_name_ciphertext: string
  workspace_slug: string
  workspace_role: WorkspaceRole
  plan_code: string
}

function planByCode(code: string): PlanDefinition {
  return PLANS.find((plan) => plan.code === code) || PLANS[0]!
}

function mapSubject(row: SessionSubjectRow): { user: PublicUser; workspace: WorkspaceSummary } {
  return {
    user: {
      id: row.user_id,
      email: row.email,
      displayName: row.display_name,
      globalRole: row.global_role,
      mustChangePassword: row.must_change_password
    },
    workspace: {
      id: row.workspace_id,
      name: row.workspace_name,
      slug: row.workspace_slug,
      role: row.workspace_role,
      plan: planByCode(row.plan_code)
    }
  }
}

export async function loadSessionSubject(userId: string, workspaceId?: string): Promise<SessionSubjectRow | null> {
  const result = await db.query<EncryptedSessionSubjectRow>(
    `SELECT
       u.id AS user_id, u.email_ciphertext, u.display_name_ciphertext, u.global_role, u.must_change_password,
       w.id AS workspace_id, w.name_ciphertext AS workspace_name_ciphertext, w.slug AS workspace_slug,
       wm.role AS workspace_role, COALESCE(s.plan_code, 'community') AS plan_code
     FROM users u
     JOIN workspace_members wm ON wm.user_id = u.id
     JOIN workspaces w ON w.id = wm.workspace_id
     LEFT JOIN subscriptions s ON s.workspace_id = w.id AND s.status IN ('active', 'trialing')
     WHERE u.id = $1 AND u.disabled_at IS NULL
       AND ($2::uuid IS NULL OR w.id = $2)
     ORDER BY wm.created_at ASC
     LIMIT 1`,
    [userId, workspaceId || null]
  )
  const row = result.rows[0]
  if (!row) return null
  return {
    user_id: row.user_id,
    email: decryptField(row.email_ciphertext, 'user.email'),
    display_name: decryptField(row.display_name_ciphertext, 'user.displayName'),
    global_role: row.global_role,
    must_change_password: row.must_change_password,
    workspace_id: row.workspace_id,
    workspace_name: decryptField(row.workspace_name_ciphertext, 'workspace.name'),
    workspace_slug: row.workspace_slug,
    workspace_role: row.workspace_role,
    plan_code: row.plan_code
  }
}

function requestMetadata(request: FastifyRequest): { userAgentHash: string; ipHash: string } {
  return {
    userAgentHash: hashMetadata(request.headers['user-agent'] || 'unknown', 'user-agent'),
    ipHash: hashMetadata(request.ip || 'unknown', 'ip')
  }
}

export async function createSession(
  row: SessionSubjectRow,
  request: FastifyRequest,
  familyId = randomUUID()
): Promise<AuthSession & { refreshToken: string }> {
  const { user, workspace } = mapSubject(row)
  const scope = scopesFor(workspace.role, user.globalRole, user.mustChangePassword)
  const accessToken = await issueAccessToken({
    sub: user.id,
    workspaceId: workspace.id,
    workspaceRole: workspace.role,
    globalRole: user.globalRole,
    scope
  })
  const refresh = newRefreshToken()
  const metadata = requestMetadata(request)
  const expiresAt = new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 86_400_000)

  await db.query(
    `INSERT INTO refresh_sessions
       (family_id, user_id, workspace_id, token_hash, user_agent_hash, ip_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [familyId, user.id, workspace.id, refresh.hash, metadata.userAgentHash, metadata.ipHash, expiresAt]
  )

  return {
    accessToken,
    expiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
    user,
    workspace,
    refreshToken: refresh.token
  }
}

export async function rotateSession(
  rawToken: string,
  request: FastifyRequest
): Promise<(AuthSession & { refreshToken: string }) | null> {
  const tokenHash = hashRefreshToken(rawToken)
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const sessionResult = await client.query<{
      id: string
      family_id: string
      user_id: string
      workspace_id: string
      expires_at: Date
      rotated_at: Date | null
      revoked_at: Date | null
    }>('SELECT * FROM refresh_sessions WHERE token_hash = $1 FOR UPDATE', [tokenHash])
    const current = sessionResult.rows[0]
    if (!current) {
      await client.query('ROLLBACK')
      return null
    }

    if (current.rotated_at || current.revoked_at) {
      await client.query(
        'UPDATE refresh_sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE family_id = $1',
        [current.family_id]
      )
      await client.query('COMMIT')
      return null
    }
    if (new Date(current.expires_at).getTime() <= Date.now()) {
      await client.query('UPDATE refresh_sessions SET revoked_at = now() WHERE id = $1', [current.id])
      await client.query('COMMIT')
      return null
    }

    const row = await loadSessionSubject(current.user_id, current.workspace_id)
    if (!row) {
      await client.query('ROLLBACK')
      return null
    }
    const { user, workspace } = mapSubject(row)
    const scope = scopesFor(workspace.role, user.globalRole, user.mustChangePassword)
    const accessToken = await issueAccessToken({
      sub: user.id,
      workspaceId: workspace.id,
      workspaceRole: workspace.role,
      globalRole: user.globalRole,
      scope
    })
    const nextRefresh = newRefreshToken()
    const nextId = randomUUID()
    const metadata = requestMetadata(request)
    const expiresAt = new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 86_400_000)

    await client.query(
      `INSERT INTO refresh_sessions
        (id, family_id, user_id, workspace_id, token_hash, user_agent_hash, ip_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        nextId,
        current.family_id,
        current.user_id,
        current.workspace_id,
        nextRefresh.hash,
        metadata.userAgentHash,
        metadata.ipHash,
        expiresAt
      ]
    )
    await client.query(
      'UPDATE refresh_sessions SET rotated_at = now(), replaced_by = $1 WHERE id = $2',
      [nextId, current.id]
    )
    await client.query('COMMIT')

    return {
      accessToken,
      expiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
      user,
      workspace,
      refreshToken: nextRefresh.token
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function revokeRefreshToken(rawToken: string): Promise<void> {
  await db.query('UPDATE refresh_sessions SET revoked_at = now() WHERE token_hash = $1', [hashRefreshToken(rawToken)])
}
