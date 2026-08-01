import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type Base64URLString,
  type RegistrationResponseJSON
} from '@simplewebauthn/server'
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import { z } from 'zod'
import { createSession, loadSessionSubject, revokeRefreshToken, rotateSession } from '../auth/session.js'
import { authenticate, revokeAccessForUser } from '../auth/guard.js'
import { config } from '../config.js'
import { db } from '../db/pool.js'
import { hashPassword, verifyPassword } from '../lib/password.js'
import { blindIndex, decryptField, encryptField } from '../lib/pii.js'
import { redis } from '../lib/redis.js'
import { audit } from '../services/audit.js'

const appleKeys = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'))
const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))
const dummyPasswordHash = hashPassword(randomBytes(32).toString('base64url'))
const challengeTtlSeconds = 300

const deviceSchema = z.object({
  deviceName: z.string().trim().min(1).max(80).optional()
})
const registerSchema = deviceSchema.extend({
  email: z.email().max(254),
  password: z.string().min(12).max(200),
  displayName: z.string().trim().min(2).max(80),
  workspaceName: z.string().trim().min(2).max(100)
})
const loginSchema = deviceSchema.extend({
  email: z.email().max(254),
  password: z.string().min(1).max(200)
})
const refreshSchema = z.object({ refreshToken: z.string().min(32).max(512) })
const federatedSchema = deviceSchema.extend({
  identityToken: z.string().min(100).max(20_000),
  nonce: z.string().min(16).max(512).optional(),
  displayName: z.string().trim().min(2).max(80).optional()
})
const appleFederatedSchema = federatedSchema.extend({
  nonce: z.string().min(16).max(512)
})
const passkeyFlowSchema = z.object({
  flowId: z.uuid(),
  response: z.record(z.string(), z.unknown())
})
const passkeyLabelSchema = z.object({ label: z.string().trim().min(1).max(80).optional() })
const workspaceSchema = deviceSchema.extend({ workspaceId: z.uuid() })
const idSchema = z.uuid()
const accountDeletionSchema = z.object({ confirmation: z.literal('DELETE') })

interface FederatedIdentity {
  provider: 'apple' | 'google'
  subject: string
  email: string | null
  emailVerified: boolean
  displayName?: string
}

interface PasskeyRow {
  id: string
  user_id: string
  credential_id_ciphertext: string
  public_key: Buffer
  counter: string
  transports: AuthenticatorTransportFuture[]
}

function makeSlug(): string {
  return `workspace-${randomBytes(9).toString('hex')}`
}

function mobileSession<T extends { refreshToken: string; expiresIn: number }>(session: T) {
  return {
    ...session,
    refreshExpiresIn: config.REFRESH_TOKEN_TTL_DAYS * 86_400
  }
}

function expectedOrigins(): string[] {
  return config.PASSKEY_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean)
}

function nonceMatches(payload: JWTPayload, nonce?: string): boolean {
  if (!nonce) return true
  const hashed = createHash('sha256').update(nonce).digest('hex')
  return payload.nonce === nonce || payload.nonce === hashed
}

async function rejectTokenReplay(identityToken: string): Promise<boolean> {
  const digest = createHash('sha256').update(identityToken).digest('base64url')
  return Boolean(await redis.set(`mobile-id-token:${digest}`, '1', 'EX', 600, 'NX'))
}

async function verifyAppleIdentity(input: z.infer<typeof federatedSchema>): Promise<FederatedIdentity> {
  if (!config.APPLE_BUNDLE_ID) throw Object.assign(new Error('Sign in with Apple is not configured.'), { statusCode: 503 })
  const { payload } = await jwtVerify(input.identityToken, appleKeys, {
    issuer: 'https://appleid.apple.com',
    audience: config.APPLE_BUNDLE_ID,
    algorithms: ['RS256']
  })
  if (typeof payload.sub !== 'string' || !nonceMatches(payload, input.nonce)) {
    throw Object.assign(new Error('The Apple identity token is invalid.'), { statusCode: 401 })
  }
  if (!(await rejectTokenReplay(input.identityToken))) {
    throw Object.assign(new Error('This identity token has already been used.'), { statusCode: 409 })
  }
  return {
    provider: 'apple',
    subject: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : null,
    emailVerified: payload.email_verified === true || payload.email_verified === 'true',
    displayName: input.displayName
  }
}

async function verifyGoogleIdentity(input: z.infer<typeof federatedSchema>): Promise<FederatedIdentity> {
  const audiences = config.GOOGLE_CLIENT_IDS.split(',').map((value) => value.trim()).filter(Boolean)
  if (!audiences.length) throw Object.assign(new Error('Sign in with Google is not configured.'), { statusCode: 503 })
  const { payload } = await jwtVerify(input.identityToken, googleKeys, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: audiences,
    algorithms: ['RS256']
  })
  if (typeof payload.sub !== 'string' || !nonceMatches(payload, input.nonce)) {
    throw Object.assign(new Error('The Google identity token is invalid.'), { statusCode: 401 })
  }
  if (!(await rejectTokenReplay(input.identityToken))) {
    throw Object.assign(new Error('This identity token has already been used.'), { statusCode: 409 })
  }
  return {
    provider: 'google',
    subject: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : null,
    emailVerified: payload.email_verified === true,
    displayName: input.displayName || (typeof payload.name === 'string' ? payload.name : undefined)
  }
}

async function createPasswordAccount(input: z.infer<typeof registerSchema>): Promise<{ userId: string; workspaceId: string }> {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const normalizedEmail = input.email.trim().toLowerCase()
    const emailLookupHash = blindIndex(normalizedEmail, 'user.email')
    if ((await client.query('SELECT 1 FROM users WHERE email_lookup_hash = $1', [emailLookupHash])).rowCount) {
      throw Object.assign(new Error('An account already exists for this email.'), { statusCode: 409 })
    }
    const user = await client.query<{ id: string }>(
      `INSERT INTO users
        (email_ciphertext, email_lookup_hash, password_hash, display_name_ciphertext)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [
        encryptField(normalizedEmail, 'user.email'),
        emailLookupHash,
        await hashPassword(input.password),
        encryptField(input.displayName, 'user.displayName')
      ]
    )
    const workspace = await client.query<{ id: string }>(
      'INSERT INTO workspaces (name_ciphertext, slug) VALUES ($1, $2) RETURNING id',
      [encryptField(input.workspaceName, 'workspace.name'), makeSlug()]
    )
    const userId = user.rows[0]!.id
    const workspaceId = workspace.rows[0]!.id
    await client.query('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)', [workspaceId, userId, 'owner'])
    await client.query(
      `INSERT INTO subscriptions (workspace_id, plan_code, status, source, billing_provider)
       VALUES ($1, 'community', 'active', 'mobile_signup', 'manual')`,
      [workspaceId]
    )
    await client.query('COMMIT')
    return { userId, workspaceId }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    if ((error as { code?: string }).code === '23505') {
      throw Object.assign(new Error('An account already exists for this email.'), { statusCode: 409 })
    }
    throw error
  } finally {
    client.release()
  }
}

async function findOrCreateFederatedAccount(identity: FederatedIdentity): Promise<{ userId: string; workspaceId: string }> {
  const subjectHash = blindIndex(identity.subject, `identity.${identity.provider}.subject`)
  const existing = await db.query<{ user_id: string }>(
    'SELECT user_id FROM auth_identities WHERE provider = $1 AND subject_lookup_hash = $2',
    [identity.provider, subjectHash]
  )
  if (existing.rows[0]) {
    await db.query(
      'UPDATE auth_identities SET last_used_at = now() WHERE provider = $1 AND subject_lookup_hash = $2',
      [identity.provider, subjectHash]
    )
    const subject = await loadSessionSubject(existing.rows[0].user_id)
    if (!subject) throw Object.assign(new Error('No active workspace is available.'), { statusCode: 403 })
    return { userId: subject.user_id, workspaceId: subject.workspace_id }
  }
  if (!identity.email || !identity.emailVerified) {
    throw Object.assign(new Error('A verified email is required the first time you sign in.'), { statusCode: 422 })
  }

  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const normalizedEmail = identity.email.trim().toLowerCase()
    const emailHash = blindIndex(normalizedEmail, 'user.email')
    const matched = await client.query<{ id: string }>('SELECT id FROM users WHERE email_lookup_hash = $1 FOR UPDATE', [emailHash])
    let userId = matched.rows[0]?.id
    let workspaceId: string
    if (!userId) {
      const displayName = identity.displayName || normalizedEmail.split('@')[0] || 'Monitc User'
      const user = await client.query<{ id: string }>(
        `INSERT INTO users
          (email_ciphertext, email_lookup_hash, password_hash, display_name_ciphertext, email_verified_at)
         VALUES ($1, $2, $3, $4, now()) RETURNING id`,
        [
          encryptField(normalizedEmail, 'user.email'),
          emailHash,
          await hashPassword(randomBytes(48).toString('base64url')),
          encryptField(displayName.slice(0, 80), 'user.displayName')
        ]
      )
      userId = user.rows[0]!.id
      const workspace = await client.query<{ id: string }>(
        'INSERT INTO workspaces (name_ciphertext, slug) VALUES ($1, $2) RETURNING id',
        [encryptField(`${displayName.slice(0, 70)} Workspace`, 'workspace.name'), makeSlug()]
      )
      workspaceId = workspace.rows[0]!.id
      await client.query('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)', [workspaceId, userId, 'owner'])
      await client.query(
        `INSERT INTO subscriptions (workspace_id, plan_code, status, source, billing_provider)
         VALUES ($1, 'community', 'active', 'federated_signup', 'manual')`,
        [workspaceId]
      )
    } else {
      throw Object.assign(
        new Error('Sign in with your existing account first, then link this provider from Security settings.'),
        { statusCode: 409, errorCode: 'account_link_required' }
      )
    }
    await client.query(
      `INSERT INTO auth_identities
        (user_id, provider, subject_lookup_hash, email_ciphertext, last_used_at)
       VALUES ($1, $2, $3, $4, now())`,
      [userId, identity.provider, subjectHash, encryptField(normalizedEmail, 'identity.email')]
    )
    await client.query('COMMIT')
    return { userId, workspaceId }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

async function linkFederatedAccount(identity: FederatedIdentity, userId: string): Promise<void> {
  if (!identity.email || !identity.emailVerified) {
    throw Object.assign(new Error('A verified provider email is required to link this account.'), {
      statusCode: 422,
      errorCode: 'verified_email_required'
    })
  }
  const subject = await loadSessionSubject(userId)
  if (!subject || blindIndex(identity.email, 'user.email') !== blindIndex(subject.email, 'user.email')) {
    throw Object.assign(new Error('The provider email does not match your Monitc account.'), {
      statusCode: 403,
      errorCode: 'identity_email_mismatch'
    })
  }
  const subjectHash = blindIndex(identity.subject, `identity.${identity.provider}.subject`)
  const existing = await db.query<{ user_id: string }>(
    'SELECT user_id FROM auth_identities WHERE provider = $1 AND subject_lookup_hash = $2',
    [identity.provider, subjectHash]
  )
  if (existing.rows[0]?.user_id === userId) return
  if (existing.rows[0]) {
    throw Object.assign(new Error('This provider account is already linked to another Monitc account.'), {
      statusCode: 409,
      errorCode: 'identity_already_linked'
    })
  }
  try {
    await db.query(
      `INSERT INTO auth_identities
        (user_id, provider, subject_lookup_hash, email_ciphertext, last_used_at)
       VALUES ($1, $2, $3, $4, now())`,
      [
        userId,
        identity.provider,
        subjectHash,
        encryptField(identity.email.trim().toLowerCase(), 'identity.email')
      ]
    )
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      throw Object.assign(new Error('A provider account is already linked.'), {
        statusCode: 409,
        errorCode: 'provider_already_linked'
      })
    }
    throw error
  }
}

async function sessionFor(userId: string, workspaceId: string, request: FastifyRequest, deviceName?: string) {
  const subject = await loadSessionSubject(userId, workspaceId)
  if (!subject) throw Object.assign(new Error('No active workspace is available.'), { statusCode: 403 })
  return mobileSession(await createSession(subject, request, { clientType: 'ios', deviceName }))
}

async function getChallenge(flowId: string, kind: 'register' | 'authenticate') {
  const raw = await redis.call('GETDEL', `passkey:${kind}:${flowId}`) as string | null
  if (!raw) throw Object.assign(new Error('The passkey challenge expired or was already used.'), { statusCode: 410 })
  return JSON.parse(raw) as { challenge: string; userId?: string }
}

export async function mobileAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post('/register', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error', details: parsed.error.flatten() })
    const account = await createPasswordAccount(parsed.data)
    const session = await sessionFor(account.userId, account.workspaceId, request, parsed.data.deviceName)
    await audit({ workspaceId: account.workspaceId, actorUserId: account.userId, action: 'auth.mobile_registered', resourceType: 'user', resourceId: account.userId })
    return reply.code(201).send(session)
  })

  app.post('/login', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error' })
    const result = await db.query<{ id: string; password_hash: string; disabled_at: Date | null }>(
      'SELECT id, password_hash, disabled_at FROM users WHERE email_lookup_hash = $1',
      [blindIndex(parsed.data.email, 'user.email')]
    )
    const user = result.rows[0]
    if (!user || user.disabled_at) {
      await verifyPassword(await dummyPasswordHash, parsed.data.password)
      return reply.code(401).send({ error: 'invalid_credentials', message: 'Email or password is incorrect.' })
    }
    if (!(await verifyPassword(user.password_hash, parsed.data.password))) {
      return reply.code(401).send({ error: 'invalid_credentials', message: 'Email or password is incorrect.' })
    }
    const subject = await loadSessionSubject(user.id)
    if (!subject) return reply.code(403).send({ error: 'no_workspace' })
    await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id])
    await audit({ workspaceId: subject.workspace_id, actorUserId: user.id, action: 'auth.mobile_logged_in', resourceType: 'session' })
    return mobileSession(await createSession(subject, request, { clientType: 'ios', deviceName: parsed.data.deviceName }))
  })

  app.post('/refresh', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = refreshSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error' })
    const session = await rotateSession(parsed.data.refreshToken, request)
    if (!session) return reply.code(401).send({ error: 'invalid_refresh_token' })
    return mobileSession(session)
  })

  app.post('/logout', async (request, reply) => {
    const parsed = refreshSchema.safeParse(request.body)
    if (parsed.success) await revokeRefreshToken(parsed.data.refreshToken)
    return reply.code(204).send()
  })

  app.post('/apple', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const parsed = appleFederatedSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error' })
    const identity = await verifyAppleIdentity(parsed.data)
    const account = await findOrCreateFederatedAccount(identity)
    return sessionFor(account.userId, account.workspaceId, request, parsed.data.deviceName)
  })

  app.post('/google', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const parsed = federatedSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error' })
    const identity = await verifyGoogleIdentity(parsed.data)
    const account = await findOrCreateFederatedAccount(identity)
    return sessionFor(account.userId, account.workspaceId, request, parsed.data.deviceName)
  })

  app.post('/apple/link', { preHandler: authenticate }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'unauthorized' })
    const parsed = appleFederatedSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error' })
    await linkFederatedAccount(await verifyAppleIdentity(parsed.data), request.auth.userId)
    await audit({ workspaceId: request.auth.workspaceId, actorUserId: request.auth.userId, action: 'auth.apple_linked', resourceType: 'identity' })
    return { linked: true }
  })

  app.post('/google/link', { preHandler: authenticate }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'unauthorized' })
    const parsed = federatedSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error' })
    await linkFederatedAccount(await verifyGoogleIdentity(parsed.data), request.auth.userId)
    await audit({ workspaceId: request.auth.workspaceId, actorUserId: request.auth.userId, action: 'auth.google_linked', resourceType: 'identity' })
    return { linked: true }
  })

  app.post('/switch-workspace', { preHandler: authenticate }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'unauthorized' })
    const parsed = workspaceSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error' })
    return sessionFor(request.auth.userId, parsed.data.workspaceId, request, parsed.data.deviceName)
  })

  app.delete('/account', {
    preHandler: authenticate,
    config: { rateLimit: { max: 3, timeWindow: '1 hour' } }
  }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'unauthorized' })
    const parsed = accountDeletionSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'confirmation_required' })
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      const memberships = await client.query<{ workspace_id: string; role: string }>(
        'SELECT workspace_id, role FROM workspace_members WHERE user_id = $1 FOR UPDATE',
        [request.auth.userId]
      )
      const owned = memberships.rows.filter((row) => row.role === 'owner').map((row) => row.workspace_id)
      if (owned.length) {
        const shared = await client.query<{ workspace_id: string }>(
          `SELECT workspace_id FROM workspace_members
           WHERE workspace_id = ANY($1::uuid[])
           GROUP BY workspace_id HAVING COUNT(*) > 1`,
          [owned]
        )
        if (shared.rowCount) {
          await client.query('ROLLBACK')
          return reply.code(409).send({
            error: 'workspace_ownership_transfer_required',
            message: 'Transfer ownership of shared workspaces before deleting your account.'
          })
        }
        await client.query('DELETE FROM workspaces WHERE id = ANY($1::uuid[])', [owned])
      }

      await client.query('DELETE FROM workspace_members WHERE user_id = $1', [request.auth.userId])
      await client.query('DELETE FROM auth_identities WHERE user_id = $1', [request.auth.userId])
      await client.query('DELETE FROM passkey_credentials WHERE user_id = $1', [request.auth.userId])
      await client.query('DELETE FROM refresh_sessions WHERE user_id = $1', [request.auth.userId])
      await client.query('DELETE FROM mobile_licenses WHERE user_id = $1', [request.auth.userId])
      await client.query('DELETE FROM contact_requests WHERE user_id = $1', [request.auth.userId])
      const erasedEmail = `deleted-${randomUUID()}@invalid.local`
      await client.query(
        `UPDATE users SET
           email_ciphertext = $1,
           email_lookup_hash = $2,
           display_name_ciphertext = $3,
           password_hash = $4,
           disabled_at = now(),
           updated_at = now()
         WHERE id = $5`,
        [
          encryptField(erasedEmail, 'user.email'),
          blindIndex(erasedEmail, 'user.email'),
          encryptField('Deleted User', 'user.displayName'),
          await hashPassword(randomBytes(48).toString('base64url')),
          request.auth.userId
        ]
      )
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
    await revokeAccessForUser(request.auth.userId).catch((error) => {
      request.log.error({ err: error }, 'failed to publish account access revocation')
    })
    return reply.code(204).send()
  })

  app.post('/passkeys/registration/options', { preHandler: authenticate }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'unauthorized' })
    const credentials = await db.query<{ credential_id_ciphertext: string; transports: AuthenticatorTransportFuture[] }>(
      'SELECT credential_id_ciphertext, transports FROM passkey_credentials WHERE user_id = $1',
      [request.auth.userId]
    )
    const subject = await loadSessionSubject(request.auth.userId, request.auth.workspaceId)
    if (!subject) return reply.code(401).send({ error: 'session_subject_missing' })
    const options = await generateRegistrationOptions({
      rpName: config.PASSKEY_RP_NAME,
      rpID: config.PASSKEY_RP_ID,
      userID: Buffer.from(request.auth.userId.replaceAll('-', ''), 'hex'),
      userName: subject.email,
      userDisplayName: subject.display_name,
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      excludeCredentials: credentials.rows.map((credential) => ({
        id: decryptField(credential.credential_id_ciphertext, 'passkey.credentialId') as Base64URLString,
        transports: credential.transports
      }))
    })
    const flowId = randomUUID()
    await redis.set(
      `passkey:register:${flowId}`,
      JSON.stringify({ challenge: options.challenge, userId: request.auth.userId }),
      'EX', challengeTtlSeconds, 'NX'
    )
    return { flowId, options }
  })

  app.post('/passkeys/registration/verify', { preHandler: authenticate }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'unauthorized' })
    const parsed = passkeyFlowSchema.and(passkeyLabelSchema).safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error' })
    const challenge = await getChallenge(parsed.data.flowId, 'register')
    if (challenge.userId !== request.auth.userId) return reply.code(403).send({ error: 'challenge_owner_mismatch' })
    const verification = await verifyRegistrationResponse({
      response: parsed.data.response as unknown as RegistrationResponseJSON,
      expectedChallenge: challenge.challenge,
      expectedOrigin: expectedOrigins(),
      expectedRPID: config.PASSKEY_RP_ID,
      requireUserVerification: true
    })
    if (!verification.verified || !verification.registrationInfo) return reply.code(401).send({ error: 'passkey_verification_failed' })
    const info = verification.registrationInfo
    await db.query(
      `INSERT INTO passkey_credentials
        (user_id, credential_id_ciphertext, credential_id_lookup_hash, public_key, counter,
         transports, device_type, backed_up, label_ciphertext)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)`,
      [
        request.auth.userId,
        encryptField(info.credential.id, 'passkey.credentialId'),
        blindIndex(info.credential.id, 'passkey.credentialId'),
        Buffer.from(info.credential.publicKey),
        info.credential.counter,
        JSON.stringify(info.credential.transports || []),
        info.credentialDeviceType,
        info.credentialBackedUp,
        parsed.data.label ? encryptField(parsed.data.label, 'passkey.label') : null
      ]
    )
    await audit({ workspaceId: request.auth.workspaceId, actorUserId: request.auth.userId, action: 'auth.passkey_registered', resourceType: 'passkey' })
    return reply.code(201).send({ verified: true })
  })

  app.post('/passkeys/authentication/options', async (_request, _reply) => {
    const options = await generateAuthenticationOptions({
      rpID: config.PASSKEY_RP_ID,
      userVerification: 'required'
    })
    const flowId = randomUUID()
    await redis.set(`passkey:authenticate:${flowId}`, JSON.stringify({ challenge: options.challenge }), 'EX', challengeTtlSeconds, 'NX')
    return { flowId, options }
  })

  app.post('/passkeys/authentication/verify', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const parsed = passkeyFlowSchema.and(deviceSchema).safeParse(request.body)
    if (!parsed.success || typeof parsed.data.response.id !== 'string') return reply.code(400).send({ error: 'validation_error' })
    const challenge = await getChallenge(parsed.data.flowId, 'authenticate')
    const credentialResult = await db.query<PasskeyRow>(
      `SELECT id, user_id, credential_id_ciphertext, public_key, counter, transports
       FROM passkey_credentials WHERE credential_id_lookup_hash = $1`,
      [blindIndex(parsed.data.response.id, 'passkey.credentialId')]
    )
    const credential = credentialResult.rows[0]
    if (!credential) return reply.code(401).send({ error: 'passkey_not_found' })
    const verification = await verifyAuthenticationResponse({
      response: parsed.data.response as unknown as AuthenticationResponseJSON,
      expectedChallenge: challenge.challenge,
      expectedOrigin: expectedOrigins(),
      expectedRPID: config.PASSKEY_RP_ID,
      requireUserVerification: true,
      credential: {
        id: decryptField(credential.credential_id_ciphertext, 'passkey.credentialId') as Base64URLString,
        publicKey: new Uint8Array(credential.public_key),
        counter: Number(credential.counter),
        transports: credential.transports
      }
    })
    if (!verification.verified) return reply.code(401).send({ error: 'passkey_verification_failed' })
    await db.query(
      `UPDATE passkey_credentials
       SET counter = $1, backed_up = $2, device_type = $3, last_used_at = now()
       WHERE id = $4`,
      [verification.authenticationInfo.newCounter, verification.authenticationInfo.credentialBackedUp, verification.authenticationInfo.credentialDeviceType, credential.id]
    )
    const subject = await loadSessionSubject(credential.user_id)
    if (!subject) return reply.code(403).send({ error: 'no_workspace' })
    return mobileSession(await createSession(subject, request, { clientType: 'ios', deviceName: parsed.data.deviceName }))
  })

  app.get('/passkeys', { preHandler: authenticate }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'unauthorized' })
    const result = await db.query<{
      id: string; label_ciphertext: string | null; device_type: string; backed_up: boolean; created_at: Date; last_used_at: Date | null
    }>(
      `SELECT id, label_ciphertext, device_type, backed_up, created_at, last_used_at
       FROM passkey_credentials WHERE user_id = $1 ORDER BY created_at DESC`,
      [request.auth.userId]
    )
    return {
      passkeys: result.rows.map((row) => ({
        id: row.id,
        label: row.label_ciphertext ? decryptField(row.label_ciphertext, 'passkey.label') : 'Passkey',
        deviceType: row.device_type,
        backedUp: row.backed_up,
        createdAt: row.created_at.toISOString(),
        lastUsedAt: row.last_used_at?.toISOString() || null
      }))
    }
  })

  app.delete('/passkeys/:id', { preHandler: authenticate }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'unauthorized' })
    const parsed = idSchema.safeParse((request.params as { id?: string }).id)
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error' })
    const result = await db.query('DELETE FROM passkey_credentials WHERE id = $1 AND user_id = $2', [parsed.data, request.auth.userId])
    if (!result.rowCount) return reply.code(404).send({ error: 'passkey_not_found' })
    return reply.code(204).send()
  })
}
