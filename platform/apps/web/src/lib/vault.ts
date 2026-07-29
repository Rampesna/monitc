import sodium from 'libsodium-wrappers'
import { api } from './api'

interface VaultKey {
  keyId: string
  algorithm: string
  publicKey: string
}

export interface SshSecret {
  host: string
  port: number
  username: string
  authType: 'password' | 'privateKey'
  password?: string
  privateKey?: string
  passphrase?: string
  hostFingerprint?: string
}

let cachedKey: VaultKey | null = null

export async function sealSshSecret(secret: SshSecret): Promise<{ keyId: string; ciphertext: string }> {
  await sodium.ready
  cachedKey ??= await api<VaultKey>('/api/v1/security/vault-key')
  const publicKey = sodium.from_base64(cachedKey.publicKey, sodium.base64_variants.ORIGINAL)
  const message = sodium.from_string(JSON.stringify(secret))
  const sealed = sodium.crypto_box_seal(message, publicKey)
  return {
    keyId: cachedKey.keyId,
    ciphertext: sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL)
  }
}
