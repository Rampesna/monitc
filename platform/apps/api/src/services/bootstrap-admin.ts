import { db } from '../db/pool.js'
import { hashPassword } from '../lib/password.js'
import { blindIndex, encryptField } from '../lib/pii.js'

export async function ensureBootstrapAdmin(email?: string, password?: string): Promise<void> {
  if (!email || !password) return
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock($1)', [1_304_202_6_1])
    const existing = await client.query<{ id: string }>(
      'SELECT id FROM users WHERE email_lookup_hash = $1',
      [blindIndex(email, 'user.email')]
    )
    let userId = existing.rows[0]?.id
    if (userId) {
      await client.query(
        `UPDATE users SET global_role = 'super_admin', disabled_at = NULL, updated_at = now()
         WHERE id = $1`,
        [userId]
      )
    } else {
      const passwordHash = await hashPassword(password)
      const user = await client.query<{ id: string }>(
        `INSERT INTO users
          (email_ciphertext, email_lookup_hash, password_hash, display_name_ciphertext,
           global_role, must_change_password, email_verified_at)
         VALUES ($1, $2, $3, $4, 'super_admin', true, now())
         RETURNING id`,
        [
          encryptField(email.trim().toLowerCase(), 'user.email'),
          blindIndex(email, 'user.email'),
          passwordHash,
          encryptField('Talha', 'user.displayName')
        ]
      )
      userId = user.rows[0]!.id
    }

    const membership = await client.query<{ workspace_id: string }>(
      'SELECT workspace_id FROM workspace_members WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1',
      [userId]
    )
    if (!membership.rows[0]) {
      const workspace = await client.query<{ id: string }>(
        `INSERT INTO workspaces (name_ciphertext, slug)
         VALUES ($1, $2)
         ON CONFLICT (slug) DO UPDATE SET updated_at = now()
         RETURNING id`,
        [encryptField('monitc internal', 'workspace.name'), 'monitc-internal']
      )
      const workspaceId = workspace.rows[0]!.id
      await client.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role)
         VALUES ($1, $2, 'owner') ON CONFLICT DO NOTHING`,
        [workspaceId, userId]
      )
      await client.query(
        `INSERT INTO subscriptions (workspace_id, plan_code, status, source, assigned_by)
         VALUES ($1, 'scale', 'active', 'bootstrap', $2)
         ON CONFLICT (workspace_id) DO UPDATE SET plan_code = 'scale', status = 'active', assigned_by = $2`,
        [workspaceId, userId]
      )
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
