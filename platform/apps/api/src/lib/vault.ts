import sodium from 'libsodium-wrappers'
import { z } from 'zod'
import { config } from '../config.js'

export interface VaultSecret {
  host: string
  port: number
  username: string
  authType: 'password' | 'privateKey'
  password?: string
  privateKey?: string
  passphrase?: string
  hostFingerprint?: string
}

const vaultSecretSchema = z.object({
  host: z.string().trim().min(1).max(253),
  port: z.number().int().min(1).max(65_535),
  username: z.string().min(1).max(128),
  authType: z.enum(['password', 'privateKey']),
  password: z.string().max(4096).optional(),
  privateKey: z.string().max(200_000).optional(),
  passphrase: z.string().max(4096).optional(),
  hostFingerprint: z.string().max(256).optional()
}).superRefine((value, context) => {
  if (value.authType === 'password' && !value.password) {
    context.addIssue({ code: 'custom', path: ['password'], message: 'Password is required' })
  }
  if (value.authType === 'privateKey' && !value.privateKey) {
    context.addIssue({ code: 'custom', path: ['privateKey'], message: 'Private key is required' })
  }
})

export async function encryptVaultSecret(secret: VaultSecret): Promise<string> {
  await ready()
  const publicKey = sodium.from_base64(config.VAULT_PUBLIC_KEY_B64, sodium.base64_variants.ORIGINAL)
  const plaintext = sodium.from_string(JSON.stringify(secret))
  return sodium.to_base64(sodium.crypto_box_seal(plaintext, publicKey), sodium.base64_variants.ORIGINAL)
}

let readyPromise: Promise<void> | null = null

async function ready(): Promise<void> {
  readyPromise ??= sodium.ready
  await readyPromise
}

export async function getVaultPublicKey(): Promise<{ keyId: string; algorithm: string; publicKey: string }> {
  await ready()
  return {
    keyId: config.VAULT_KEY_ID,
    algorithm: 'crypto_box_seal/x25519-xsalsa20-poly1305',
    publicKey: config.VAULT_PUBLIC_KEY_B64
  }
}

export async function decryptVaultSecret(ciphertext: string, keyId: string): Promise<VaultSecret> {
  if (keyId !== config.VAULT_KEY_ID) throw new Error('Unsupported vault key')
  await ready()
  const cipher = sodium.from_base64(ciphertext, sodium.base64_variants.ORIGINAL)
  const publicKey = sodium.from_base64(config.VAULT_PUBLIC_KEY_B64, sodium.base64_variants.ORIGINAL)
  const privateKey = sodium.from_base64(config.VAULT_PRIVATE_KEY_B64, sodium.base64_variants.ORIGINAL)
  const plain = sodium.crypto_box_seal_open(cipher, publicKey, privateKey)
  if (!plain) throw new Error('Vault decryption failed')

  const decoded = vaultSecretSchema.safeParse(JSON.parse(sodium.to_string(plain)))
  if (!decoded.success) throw new Error('Invalid vault payload')
  return decoded.data
}
