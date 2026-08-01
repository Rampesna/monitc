import { decryptVaultSecret, encryptVaultSecret } from '../lib/vault.js'
import { collectServer } from '../services/ssh-collector.js'
import type {
  ProviderConnectionResult,
  ProviderServerRecord,
  ServerProvider
} from './server-provider.js'

export class SshProvider implements ServerProvider {
  readonly kind = 'ssh' as const
  readonly capabilities = new Set(['host-metrics', 'docker', 'kubernetes', 'terminal', 'files'] as const)

  constructor(private readonly server: ProviderServerRecord) {}

  async testConnection(): Promise<ProviderConnectionResult> {
    if (!this.server.secret_ciphertext || !this.server.secret_key_id) {
      const error = new Error('SSH fallback is not configured.') as Error & { statusCode: number }
      error.statusCode = 409
      throw error
    }
    const secret = await decryptVaultSecret(this.server.secret_ciphertext, this.server.secret_key_id)
    const snapshot = await collectServer(secret)
    let rotatedSecretCiphertext: string | undefined
    if (!secret.hostFingerprint) {
      secret.hostFingerprint = snapshot.fingerprint
      rotatedSecretCiphertext = await encryptVaultSecret(secret)
    }
    return {
      ok: true,
      provider: this.kind,
      status: 'connected',
      fingerprint: snapshot.fingerprint,
      system: snapshot.system,
      kubernetesPods: snapshot.pods.length,
      rotatedSecretCiphertext
    }
  }
}
