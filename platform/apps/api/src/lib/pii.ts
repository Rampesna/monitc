import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto'
import { config } from '../config.js'

const VERSION = 'v1'

function decodeKey(value: string, name: string): Buffer {
  const key = Buffer.from(value, 'base64url')
  if (key.length !== 32) throw new Error(`${name} must decode to exactly 32 bytes`)
  return key
}

const encryptionKey = decodeKey(config.PII_ENCRYPTION_KEY_B64, 'PII_ENCRYPTION_KEY_B64')
const indexKey = decodeKey(config.PII_INDEX_KEY_B64, 'PII_INDEX_KEY_B64')

export function encryptField(value: string, context: string): string {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, nonce)
  cipher.setAAD(Buffer.from(`${VERSION}:${context}`, 'utf8'))
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [
    VERSION,
    nonce.toString('base64url'),
    ciphertext.toString('base64url'),
    tag.toString('base64url')
  ].join('.')
}

export function decryptField(value: string, context: string): string {
  const [version, nonceValue, ciphertextValue, tagValue] = value.split('.')
  if (version !== VERSION || !nonceValue || ciphertextValue === undefined || !tagValue) {
    throw new Error('Unsupported encrypted field')
  }
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(nonceValue, 'base64url'))
  decipher.setAAD(Buffer.from(`${VERSION}:${context}`, 'utf8'))
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, 'base64url')),
    decipher.final()
  ]).toString('utf8')
}

export function blindIndex(value: string, context: string): string {
  const normalized = value.normalize('NFKC').trim().toLocaleLowerCase('en-US')
  return createHmac('sha256', indexKey)
    .update(`${VERSION}:${context}\u0000${normalized}`, 'utf8')
    .digest('base64url')
}
