import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { importPKCS8, importSPKI, jwtVerify, SignJWT, type JWTPayload } from 'jose'
import { config } from '../config.js'
import { blindIndex } from './pii.js'

export interface AccessClaims extends JWTPayload {
  sub: string
  workspaceId: string
  workspaceRole: string
  globalRole: string
  scope: string[]
}

let privateKeyPromise: ReturnType<typeof importPKCS8> | null = null
let publicKeyPromise: ReturnType<typeof importSPKI> | null = null

function decodePem(value: string): string {
  return Buffer.from(value, 'base64').toString('utf8')
}

function privateKey() {
  privateKeyPromise ??= importPKCS8(decodePem(config.JWT_PRIVATE_KEY_B64), 'EdDSA')
  return privateKeyPromise
}

function publicKey() {
  publicKeyPromise ??= importSPKI(decodePem(config.JWT_PUBLIC_KEY_B64), 'EdDSA')
  return publicKeyPromise
}

export async function issueAccessToken(claims: Omit<AccessClaims, 'iss' | 'aud' | 'iat' | 'exp' | 'jti'>): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'EdDSA', kid: config.JWT_KEY_ID, typ: 'at+jwt' })
    .setIssuer(config.JWT_ISSUER)
    .setAudience(config.JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${config.ACCESS_TOKEN_TTL_SECONDS}s`)
    .setJti(randomUUID())
    .sign(await privateKey())
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  const result = await jwtVerify(token, await publicKey(), {
    issuer: config.JWT_ISSUER,
    audience: config.JWT_AUDIENCE,
    algorithms: ['EdDSA'],
    typ: 'at+jwt',
    clockTolerance: 5
  })
  const payload = result.payload
  if (
    typeof payload.sub !== 'string' ||
    typeof payload.workspaceId !== 'string' ||
    typeof payload.workspaceRole !== 'string' ||
    typeof payload.globalRole !== 'string' ||
    !Array.isArray(payload.scope) ||
    !payload.scope.every((scope) => typeof scope === 'string')
  ) {
    throw new Error('Invalid access token claims')
  }
  return payload as AccessClaims
}

export function newRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(48).toString('base64url')
  return { token, hash: hashRefreshToken(token) }
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url')
}

export function hashMetadata(value: string, context: 'ip' | 'user-agent'): string {
  return blindIndex(value, `session.${context}`)
}
