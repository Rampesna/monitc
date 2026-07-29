import { db } from '../db/pool.js'

export async function audit(entry: {
  workspaceId?: string | null
  actorUserId?: string | null
  action: string
  resourceType: string
  resourceId?: string | null
  metadata?: Record<string, unknown>
  ipHash?: string | null
}): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs
      (workspace_id, actor_user_id, action, resource_type, resource_id, metadata, ip_hash)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [
      entry.workspaceId || null,
      entry.actorUserId || null,
      entry.action,
      entry.resourceType,
      entry.resourceId || null,
      JSON.stringify(entry.metadata || {}),
      entry.ipHash || null
    ]
  )
}
