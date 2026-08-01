import { createHash } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate, requireScope } from '../auth/guard.js'
import { db } from '../db/pool.js'
import { blindIndex, encryptField } from '../lib/pii.js'
import {
  billingState,
  entitlementState,
  renewalEnabled,
  verifyAppleNotification,
  verifyAppleTransaction,
  type AppleEnvironment,
  type BillingState,
  type VerifiedAppleNotification
} from '../services/apple-billing.js'
import { audit } from '../services/audit.js'
import type { JWSRenewalInfoDecodedPayload, JWSTransactionDecodedPayload } from '@apple/app-store-server-library'

const transactionSchema = z.object({ signedTransactionInfo: z.string().min(100).max(100_000) })
const notificationSchema = z.object({ signedPayload: z.string().min(100).max(250_000) })

interface ProductRow {
  provider: 'apple' | 'google_play'
  product_id: string
  product_kind: 'hosted_plan' | 'self_hosted_mobile'
  plan_code: string | null
  billing_period: 'monthly' | 'annual'
  price_cents: number
  currency: string
}

interface BillingOwner {
  userId: string
  workspaceId: string
}

function dateFromMillis(value?: number): Date | null {
  return value && Number.isFinite(value) ? new Date(value) : null
}

function transactionHash(value: string): string {
  return blindIndex(value, 'billing.apple.transaction')
}

async function productFor(productId: string): Promise<ProductRow> {
  const result = await db.query<ProductRow>(
    `SELECT provider, product_id, product_kind, plan_code, billing_period, price_cents, currency
     FROM billing_products WHERE provider = 'apple' AND product_id = $1 AND active = true`,
    [productId]
  )
  if (!result.rows[0]) throw Object.assign(new Error('This App Store product is not supported.'), { statusCode: 422 })
  return result.rows[0]
}

async function resolveNotificationOwner(transaction: JWSTransactionDecodedPayload): Promise<BillingOwner | null> {
  if (transaction.transactionId) {
    const existing = await db.query<{ user_id: string; workspace_id: string }>(
      `SELECT user_id, workspace_id FROM billing_transactions
       WHERE provider = 'apple' AND transaction_lookup_hash = $1
       ORDER BY updated_at DESC LIMIT 1`,
      [transactionHash(transaction.transactionId)]
    )
    if (existing.rows[0]) return { userId: existing.rows[0].user_id, workspaceId: existing.rows[0].workspace_id }
  }
  if (transaction.originalTransactionId) {
    const existing = await db.query<{ user_id: string; workspace_id: string }>(
      `SELECT user_id, workspace_id FROM billing_transactions
       WHERE provider = 'apple' AND original_transaction_lookup_hash = $1
       ORDER BY updated_at DESC LIMIT 1`,
      [blindIndex(transaction.originalTransactionId, 'billing.apple.originalTransaction')]
    )
    if (existing.rows[0]) return { userId: existing.rows[0].user_id, workspaceId: existing.rows[0].workspace_id }
  }
  if (!transaction.appAccountToken || !z.uuid().safeParse(transaction.appAccountToken).success) return null
  const membership = await db.query<{ user_id: string; workspace_id: string }>(
    `SELECT wm.user_id, wm.workspace_id FROM workspace_members wm
     JOIN users u ON u.id = wm.user_id AND u.disabled_at IS NULL
     WHERE wm.user_id = $1
     ORDER BY CASE wm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, wm.created_at
     LIMIT 1`,
    [transaction.appAccountToken]
  )
  return membership.rows[0]
    ? { userId: membership.rows[0].user_id, workspaceId: membership.rows[0].workspace_id }
    : null
}

async function persistApplePurchase(input: {
  owner: BillingOwner
  environment: AppleEnvironment
  transaction: JWSTransactionDecodedPayload
  renewal?: JWSRenewalInfoDecodedPayload
  subscriptionStatus?: number
  signedTransactionInfo: string
}): Promise<{ transactionId: string; state: BillingState; product: ProductRow }> {
  const { owner, environment, transaction, renewal, subscriptionStatus, signedTransactionInfo } = input
  if (!transaction.transactionId || !transaction.productId) {
    throw Object.assign(new Error('The App Store transaction is missing required identifiers.'), { statusCode: 422 })
  }
  if (transaction.appAccountToken && transaction.appAccountToken !== owner.userId) {
    throw Object.assign(new Error('This purchase belongs to another account.'), { statusCode: 403 })
  }
  const product = await productFor(transaction.productId)
  const state = billingState(transaction, subscriptionStatus)
  const entitledState = entitlementState(state)
  const autoRenews = renewalEnabled(renewal)
  const originalHash = transaction.originalTransactionId
    ? blindIndex(transaction.originalTransactionId, 'billing.apple.originalTransaction')
    : transactionHash(transaction.transactionId)
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const stored = await client.query<{ id: string }>(
      `INSERT INTO billing_transactions
        (workspace_id, user_id, provider, environment, transaction_lookup_hash,
         original_transaction_lookup_hash, product_id, status, auto_renews, purchased_at,
         expires_at, revoked_at, signed_payload_ciphertext)
       VALUES ($1, $2, 'apple', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (provider, environment, transaction_lookup_hash) DO UPDATE SET
         workspace_id = EXCLUDED.workspace_id,
         user_id = EXCLUDED.user_id,
         original_transaction_lookup_hash = EXCLUDED.original_transaction_lookup_hash,
         product_id = EXCLUDED.product_id,
         status = EXCLUDED.status,
         auto_renews = EXCLUDED.auto_renews,
         purchased_at = EXCLUDED.purchased_at,
         expires_at = EXCLUDED.expires_at,
         revoked_at = EXCLUDED.revoked_at,
         signed_payload_ciphertext = EXCLUDED.signed_payload_ciphertext,
         updated_at = now()
       RETURNING id`,
      [
        owner.workspaceId,
        owner.userId,
        environment,
        transactionHash(transaction.transactionId),
        originalHash,
        transaction.productId,
        state,
        autoRenews,
        dateFromMillis(transaction.purchaseDate),
        dateFromMillis(transaction.expiresDate),
        dateFromMillis(transaction.revocationDate),
        encryptField(signedTransactionInfo, 'billing.signedPayload')
      ]
    )
    const storedTransactionId = stored.rows[0]!.id
    if (product.product_kind === 'hosted_plan' && product.plan_code) {
      await client.query(
        `INSERT INTO subscriptions
          (workspace_id, plan_code, status, source, billing_provider, billing_period,
           external_entitlement_hash, current_period_ends_at, auto_renews)
         VALUES ($1, $2, $3, 'apple_store', 'apple', $4, $5, $6, $7)
         ON CONFLICT (workspace_id) DO UPDATE SET
           plan_code = EXCLUDED.plan_code,
           status = EXCLUDED.status,
           source = EXCLUDED.source,
           billing_provider = EXCLUDED.billing_provider,
           billing_period = EXCLUDED.billing_period,
           external_entitlement_hash = EXCLUDED.external_entitlement_hash,
           current_period_ends_at = EXCLUDED.current_period_ends_at,
           auto_renews = EXCLUDED.auto_renews,
           updated_at = now()
         WHERE subscriptions.source <> 'manual' OR subscriptions.plan_code <> 'scale'`,
        [owner.workspaceId, product.plan_code, entitledState, product.billing_period, originalHash, dateFromMillis(transaction.expiresDate), autoRenews]
      )
    } else {
      await client.query(
        `INSERT INTO mobile_licenses
          (user_id, workspace_id, provider, source_transaction_id, status,
           current_period_ends_at, auto_renews)
         VALUES ($1, $2, 'apple', $3, $4, $5, $6)
         ON CONFLICT (user_id) DO UPDATE SET
           workspace_id = EXCLUDED.workspace_id,
           provider = EXCLUDED.provider,
           source_transaction_id = EXCLUDED.source_transaction_id,
           status = EXCLUDED.status,
           current_period_ends_at = EXCLUDED.current_period_ends_at,
           auto_renews = EXCLUDED.auto_renews,
           updated_at = now()`,
        [owner.userId, owner.workspaceId, storedTransactionId, entitledState, dateFromMillis(transaction.expiresDate), autoRenews]
      )
    }
    await client.query('COMMIT')
    return { transactionId: storedTransactionId, state, product }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

async function processNotification(verified: VerifiedAppleNotification, signedPayload: string): Promise<'processed' | 'ignored'> {
  const eventId = verified.notification.notificationUUID
    || createHash('sha256').update(signedPayload).digest('base64url')
  const eventHash = blindIndex(eventId, 'billing.apple.webhook')
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO billing_webhook_events (provider, event_lookup_hash, payload_ciphertext)
     VALUES ('apple', $1, $2)
     ON CONFLICT (provider, event_lookup_hash) DO UPDATE SET
       payload_ciphertext = EXCLUDED.payload_ciphertext,
       status = 'received',
       error_code = NULL,
       processed_at = NULL
     WHERE billing_webhook_events.status = 'failed'
     RETURNING id`,
    [eventHash, encryptField(signedPayload, 'billing.webhookPayload')]
  )
  if (!inserted.rows[0]) return 'processed'
  const eventRowId = inserted.rows[0].id
  try {
    if (!verified.transaction || !verified.notification.data?.signedTransactionInfo) {
      await db.query(
        `UPDATE billing_webhook_events SET status = 'ignored', processed_at = now() WHERE id = $1`,
        [eventRowId]
      )
      return 'ignored'
    }
    const owner = await resolveNotificationOwner(verified.transaction)
    if (!owner) {
      await db.query(
        `UPDATE billing_webhook_events SET status = 'ignored', error_code = 'owner_not_found', processed_at = now() WHERE id = $1`,
        [eventRowId]
      )
      return 'ignored'
    }
    await persistApplePurchase({
      owner,
      environment: verified.environment,
      transaction: verified.transaction,
      renewal: verified.renewal,
      subscriptionStatus: verified.notification.data.status,
      signedTransactionInfo: verified.notification.data.signedTransactionInfo
    })
    await db.query(
      `UPDATE billing_webhook_events SET status = 'processed', processed_at = now() WHERE id = $1`,
      [eventRowId]
    )
    return 'processed'
  } catch (error) {
    await db.query(
      `UPDATE billing_webhook_events SET status = 'failed', error_code = $2, processed_at = now() WHERE id = $1`,
      [eventRowId, (error as Error).name.slice(0, 80)]
    ).catch(() => undefined)
    throw error
  }
}

export async function mobileBillingRoutes(app: FastifyInstance): Promise<void> {
  app.get('/products', async () => {
    const result = await db.query<ProductRow>(
      `SELECT provider, product_id, product_kind, plan_code, billing_period, price_cents, currency
       FROM billing_products WHERE active = true ORDER BY provider, product_kind, price_cents`
    )
    return {
      products: result.rows.map((row) => ({
        provider: row.provider,
        productId: row.product_id,
        kind: row.product_kind,
        planCode: row.plan_code,
        period: row.billing_period,
        referencePrice: { amount: row.price_cents / 100, currency: row.currency }
      }))
    }
  })

  app.get('/entitlements', { preHandler: authenticate }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'unauthorized' })
    const [subscription, license] = await Promise.all([
      db.query<{
        plan_code: string; status: string; billing_provider: string; billing_period: string | null;
        current_period_ends_at: Date | null; auto_renews: boolean
      }>(
        `SELECT plan_code, status, billing_provider, billing_period, current_period_ends_at, auto_renews
         FROM subscriptions WHERE workspace_id = $1`,
        [request.auth.workspaceId]
      ),
      db.query<{
        status: string; provider: string; max_instances: number; current_period_ends_at: Date | null; auto_renews: boolean
      }>(
        `SELECT status, provider, max_instances, current_period_ends_at, auto_renews
         FROM mobile_licenses WHERE user_id = $1`,
        [request.auth.userId]
      )
    ])
    const hosted = subscription.rows[0]
    const selfHosted = license.rows[0]
    return {
      appAccountToken: request.auth.userId,
      hosted: hosted ? {
        planCode: hosted.plan_code,
        status: hosted.status,
        provider: hosted.billing_provider,
        period: hosted.billing_period,
        currentPeriodEndsAt: hosted.current_period_ends_at?.toISOString() || null,
        autoRenews: hosted.auto_renews
      } : null,
      selfHostedMobile: selfHosted ? {
        status: selfHosted.status,
        provider: selfHosted.provider,
        maxInstances: selfHosted.max_instances,
        currentPeriodEndsAt: selfHosted.current_period_ends_at?.toISOString() || null,
        autoRenews: selfHosted.auto_renews
      } : null
    }
  })

  app.post('/apple/transactions', { preHandler: requireScope('billing:manage') }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'unauthorized' })
    const parsed = transactionSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error' })
    const verified = await verifyAppleTransaction(parsed.data.signedTransactionInfo)
    if (!verified.transaction.appAccountToken) {
      return reply.code(422).send({ error: 'app_account_token_required' })
    }
    const stored = await persistApplePurchase({
      owner: { userId: request.auth.userId, workspaceId: request.auth.workspaceId },
      environment: verified.environment,
      transaction: verified.transaction,
      signedTransactionInfo: parsed.data.signedTransactionInfo
    })
    await audit({
      workspaceId: request.auth.workspaceId,
      actorUserId: request.auth.userId,
      action: 'billing.apple_transaction_verified',
      resourceType: 'billing_transaction',
      resourceId: stored.transactionId,
      metadata: { productId: stored.product.product_id, environment: verified.environment, status: stored.state }
    })
    return { verified: true, status: stored.state, productId: stored.product.product_id }
  })

  app.post('/apple/notifications', { config: { rateLimit: { max: 1_000, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = notificationSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error' })
    const verified = await verifyAppleNotification(parsed.data.signedPayload)
    await processNotification(verified, parsed.data.signedPayload)
    return reply.code(204).send()
  })
}
