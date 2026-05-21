import crypto from 'crypto'

const ITERATIONS = 100000
const KEY_LEN = 32
const DIGEST = 'sha512'
const ALGORITHM = 'aes-256-gcm'

function deriveKey(licenseKey: string, machineId: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(licenseKey + machineId, salt, ITERATIONS, KEY_LEN, DIGEST)
}

export function encrypt(plaintext: string, licenseKey: string, machineId: string): string {
  const salt = crypto.randomBytes(32)
  const iv = crypto.randomBytes(16)
  const key = deriveKey(licenseKey, machineId, salt)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv) as crypto.CipherGCM
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [
    salt.toString('base64'),
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64')
  ].join(':')
}

export function decrypt(ciphertext: string, licenseKey: string, machineId: string): string {
  const parts = ciphertext.split(':')
  if (parts.length !== 4) throw new Error('Invalid ciphertext format')
  const [saltB64, ivB64, authTagB64, dataB64] = parts
  const salt = Buffer.from(saltB64, 'base64')
  const iv = Buffer.from(ivB64, 'base64')
  const authTag = Buffer.from(authTagB64, 'base64')
  const data = Buffer.from(dataB64, 'base64')
  const key = deriveKey(licenseKey, machineId, salt)
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv) as crypto.DecipherGCM
  decipher.setAuthTag(authTag)
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()])
  return decrypted.toString('utf8')
}
