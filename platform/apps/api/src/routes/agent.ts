import { readFile } from 'node:fs/promises'
import type { FastifyInstance } from 'fastify'
import { config } from '../config.js'

export async function agentBootstrapRoutes(app: FastifyInstance): Promise<void> {
  app.get('/bootstrap-ca', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
  }, async (_request, reply) => {
    try {
      const certificate = await readFile(config.AGENT_CA_CERT_PATH)
      return reply
        .header('content-type', 'application/x-pem-file')
        .header('content-disposition', 'inline; filename="monitc-agent-ca.crt"')
        .header('cache-control', 'public, max-age=3600')
        .send(certificate)
    } catch {
      return reply.code(503).send({ error: 'agent_ca_unavailable' })
    }
  })
}
