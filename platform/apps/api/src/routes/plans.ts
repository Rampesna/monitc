import type { FastifyInstance } from 'fastify'
import { PLANS } from '@monitc/shared'
import { z } from 'zod'
import { requireScope } from '../auth/guard.js'
import { db } from '../db/pool.js'
import { encryptField } from '../lib/pii.js'
import { audit } from '../services/audit.js'

const contactSchema = z.object({
  planCode: z.enum(['solo', 'team', 'scale']),
  message: z.string().trim().max(1000).optional()
})

export async function planRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async () => ({ plans: PLANS }))

  app.post('/contact', { preHandler: requireScope('billing:manage') }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'unauthorized' })
    const parsed = contactSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error' })
    const existing = await db.query<{ id: string }>(
      `SELECT id FROM contact_requests
       WHERE workspace_id = $1 AND requested_plan_code = $2 AND status IN ('new', 'contacted')
       ORDER BY created_at DESC LIMIT 1`,
      [request.auth.workspaceId, parsed.data.planCode]
    )
    if (existing.rows[0]) return reply.code(200).send({ id: existing.rows[0].id, status: 'already_requested' })

    const result = await db.query<{ id: string }>(
      `INSERT INTO contact_requests (workspace_id, user_id, requested_plan_code, message_ciphertext)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [
        request.auth.workspaceId,
        request.auth.userId,
        parsed.data.planCode,
        parsed.data.message ? encryptField(parsed.data.message, 'contact.message') : null
      ]
    )
    await audit({
      workspaceId: request.auth.workspaceId,
      actorUserId: request.auth.userId,
      action: 'billing.contact_requested',
      resourceType: 'plan',
      resourceId: parsed.data.planCode
    })
    return reply.code(201).send({
      id: result.rows[0]!.id,
      status: 'new',
      message: 'Your request is ready. We will contact you to activate the plan manually.'
    })
  })
}
