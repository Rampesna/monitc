import { randomUUID } from 'node:crypto'
import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import websocket from '@fastify/websocket'
import { config } from './config.js'
import { db } from './db/pool.js'
import { redis } from './lib/redis.js'
import { authRoutes } from './routes/auth.js'
import { securityRoutes } from './routes/security.js'
import { planRoutes } from './routes/plans.js'
import { workspaceRoutes } from './routes/workspace.js'
import { serverRoutes } from './routes/servers.js'
import { metricRoutes } from './routes/metrics.js'
import { adminRoutes } from './routes/admin.js'
import { releaseRoutes } from './routes/releases.js'
import { alertRoutes } from './routes/alerts.js'
import { accessRoutes, terminalSocketRoutes } from './routes/access.js'
import { agentBootstrapRoutes } from './routes/agent.js'
import './types.js'

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'request.body.password',
          'request.body.currentPassword',
          'request.body.newPassword',
          'request.body.encryptedSecret',
          'response.refreshToken'
        ],
        censor: '[REDACTED]'
      }
    },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 1_048_576,
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID()
  })

  app.decorateRequest('auth', null)
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
    strictTransportSecurity: config.NODE_ENV === 'production'
      ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
      : false
  })
  await app.register(cors, {
    origin: [config.APP_ORIGIN, config.ADMIN_ORIGIN],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type', 'x-request-id']
  })
  await app.register(cookie)
  await app.register(multipart, {
    limits: { files: 20, fileSize: 2 * 1024 ** 3, fields: 10, parts: 30 }
  })
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } })
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    redis,
    keyGenerator: (request) => request.ip
  })

  const healthRouteOptions = {
    config: { rateLimit: false },
    logLevel: 'silent' as const
  }

  app.get('/health/live', healthRouteOptions, async () => ({
    status: 'ok',
    service: 'monitc-api',
    version: '1.5.0'
  }))
  app.get('/health/ready', healthRouteOptions, async (_request, reply) => {
    try {
      await Promise.all([db.query('SELECT 1'), redis.ping()])
      return { status: 'ready' }
    } catch {
      return reply.code(503).send({ status: 'not_ready' })
    }
  })

  await app.register(authRoutes, { prefix: '/api/v1/auth' })
  await app.register(securityRoutes, { prefix: '/api/v1/security' })
  await app.register(planRoutes, { prefix: '/api/v1/plans' })
  await app.register(workspaceRoutes, { prefix: '/api/v1/workspaces' })
  await app.register(serverRoutes, { prefix: '/api/v1/servers' })
  await app.register(accessRoutes, { prefix: '/api/v1/servers' })
  await app.register(metricRoutes, { prefix: '/api/v1/metrics/servers' })
  await app.register(alertRoutes, { prefix: '/api/v1/alerts' })
  await app.register(adminRoutes, { prefix: '/api/v1/admin' })
  await app.register(releaseRoutes, { prefix: '/api/v1/releases' })
  await app.register(agentBootstrapRoutes, { prefix: '/api/v1/agent' })
  await app.register(terminalSocketRoutes, { prefix: '/api/v1/ws' })

  app.setNotFoundHandler(async (_request, reply) => {
    await reply.code(404).send({ error: 'not_found' })
  })
  app.setErrorHandler(async (error, request, reply) => {
    const normalized = error as Error & { statusCode?: number }
    request.log.error({ err: normalized }, 'request failed')
    const statusCode = normalized.statusCode && normalized.statusCode >= 400 && normalized.statusCode < 500
      ? normalized.statusCode
      : 500
    await reply.code(statusCode).send({
      error: statusCode === 500 ? 'internal_error' : 'request_error',
      message: statusCode === 500 ? 'The request could not be completed.' : normalized.message,
      requestId: request.id
    })
  })

  return app
}
