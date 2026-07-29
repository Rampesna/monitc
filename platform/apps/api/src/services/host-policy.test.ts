import assert from 'node:assert/strict'
import test from 'node:test'

const key = Buffer.alloc(32, 11).toString('base64url')
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
  PII_INDEX_KEY_B64: Buffer.alloc(32, 12).toString('base64url')
})

const { isPrivateAddress } = await import('./host-policy.js')

test('blocks private and special-purpose IPv4 targets', () => {
  for (const address of ['127.0.0.1', '10.2.3.4', '169.254.1.1', '100.64.0.1', '224.0.0.1']) {
    assert.equal(isPrivateAddress(address), true, address)
  }
  assert.equal(isPrivateAddress('45.131.1.244'), false)
})

test('blocks IPv6 private, mapped and transition targets', () => {
  for (const address of ['::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '64:ff9b::7f00:1', '2002:7f00:1::']) {
    assert.equal(isPrivateAddress(address), true, address)
  }
  assert.equal(isPrivateAddress('2606:4700:4700::1111'), false)
})
