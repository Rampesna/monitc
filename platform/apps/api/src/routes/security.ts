import type { FastifyInstance } from 'fastify'
import { getVaultPublicKey } from '../lib/vault.js'

export async function securityRoutes(app: FastifyInstance): Promise<void> {
  app.get('/vault-key', async () => getVaultPublicKey())
}
