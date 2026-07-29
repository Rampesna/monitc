import assert from 'node:assert/strict'
import test from 'node:test'

const key = Buffer.alloc(32, 7).toString('base64url')
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  REDIS_MODE: 'standalone',
  REDIS_NODES: 'localhost:6379',
  REDIS_PASSWORD: 'test-password-1234',
  JWT_PRIVATE_KEY_B64: 'test',
  JWT_PUBLIC_KEY_B64: 'test',
  JWT_ISSUER: 'https://api.example.test',
  VAULT_PUBLIC_KEY_B64: 'test',
  VAULT_PRIVATE_KEY_B64: 'test',
  PII_ENCRYPTION_KEY_B64: key,
  PII_INDEX_KEY_B64: Buffer.alloc(32, 9).toString('base64url')
})

const { blindIndex, decryptField, encryptField } = await import('./pii.js')

test('encrypts PII with authenticated context binding', () => {
  const ciphertext = encryptField('talha@example.com', 'user.email')
  assert.equal(ciphertext.includes('talha@example.com'), false)
  assert.equal(decryptField(ciphertext, 'user.email'), 'talha@example.com')
  assert.throws(() => decryptField(ciphertext, 'workspace.name'))
})

test('creates normalized, context-separated blind indexes', () => {
  assert.equal(
    blindIndex(' Talha@Example.com ', 'user.email'),
    blindIndex('talha@example.com', 'user.email')
  )
  assert.notEqual(
    blindIndex('talha@example.com', 'user.email'),
    blindIndex('talha@example.com', 'another.context')
  )
})
