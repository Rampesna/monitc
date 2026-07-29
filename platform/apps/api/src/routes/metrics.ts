import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireScope } from '../auth/guard.js'
import { db } from '../db/pool.js'
import { percent } from '../services/resource-units.js'

const idSchema = z.uuid()

export async function metricRoutes(app: FastifyInstance): Promise<void> {
  app.get('/:id/history', { preHandler: requireScope('metrics:read') }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'unauthorized' })
    const id = idSchema.safeParse((request.params as { id?: string }).id)
    const query = z.object({ hours: z.coerce.number().min(1).max(168).default(1) }).safeParse(request.query)
    if (!id.success || !query.success) return reply.code(400).send({ error: 'validation_error' })
    const server = await db.query(
      'SELECT 1 FROM server_connections WHERE id = $1 AND workspace_id = $2',
      [id.data, request.auth.workspaceId]
    )
    if (!server.rowCount) return reply.code(404).send({ error: 'server_not_found' })
    const result = await db.query<{
      sampled_at: Date
      cpu_percent: number
      memory_percent: number
      disk_percent: number
      network_rx_rate: number
      network_tx_rate: number
    }>(
      `SELECT sampled_at, cpu_percent, memory_percent, disk_percent, network_rx_rate, network_tx_rate
       FROM system_metric_samples
       WHERE workspace_id = $1 AND server_id = $2
         AND sampled_at >= now() - ($3::text || ' hours')::interval
       ORDER BY sampled_at ASC
       LIMIT 2000`,
      [request.auth.workspaceId, id.data, query.data.hours]
    )
    return {
      points: result.rows.map((row) => ({
        timestamp: row.sampled_at.toISOString(),
        cpuPercent: row.cpu_percent,
        memoryPercent: row.memory_percent,
        diskPercent: row.disk_percent,
        networkRxBytesPerSecond: row.network_rx_rate,
        networkTxBytesPerSecond: row.network_tx_rate
      }))
    }
  })

  app.get('/:id/pods', { preHandler: requireScope('metrics:read') }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'unauthorized' })
    const id = idSchema.safeParse((request.params as { id?: string }).id)
    if (!id.success) return reply.code(400).send({ error: 'validation_error' })
    const server = await db.query(
      'SELECT 1 FROM server_connections WHERE id = $1 AND workspace_id = $2',
      [id.data, request.auth.workspaceId]
    )
    if (!server.rowCount) return reply.code(404).send({ error: 'server_not_found' })
    const result = await db.query<{
      namespace: string
      pod_name: string
      node_name: string
      phase: string
      ready: string
      restarts: number
      cpu_usage_millicores: number
      cpu_request_millicores: number
      cpu_limit_millicores: number
      memory_usage_bytes: number
      memory_request_bytes: number
      memory_limit_bytes: number
      network_rx_rate: number
      network_tx_rate: number
      sampled_at: Date
    }>(
      `SELECT DISTINCT ON (namespace, pod_name)
        namespace, pod_name, node_name, phase, ready, restarts,
        cpu_usage_millicores, cpu_request_millicores, cpu_limit_millicores,
        memory_usage_bytes, memory_request_bytes, memory_limit_bytes,
        network_rx_rate, network_tx_rate, sampled_at
       FROM kubernetes_pod_samples
       WHERE workspace_id = $1 AND server_id = $2
       ORDER BY namespace, pod_name, sampled_at DESC`,
      [request.auth.workspaceId, id.data]
    )
    return {
      pods: result.rows.map((row) => ({
        namespace: row.namespace,
        name: row.pod_name,
        node: row.node_name,
        phase: row.phase,
        ready: row.ready,
        restarts: row.restarts,
        cpuUsageMillicores: row.cpu_usage_millicores,
        cpuRequestMillicores: row.cpu_request_millicores,
        cpuLimitMillicores: row.cpu_limit_millicores,
        cpuUsagePercent: percent(row.cpu_usage_millicores, row.cpu_limit_millicores || row.cpu_request_millicores),
        memoryUsageBytes: row.memory_usage_bytes,
        memoryRequestBytes: row.memory_request_bytes,
        memoryLimitBytes: row.memory_limit_bytes,
        memoryUsagePercent: percent(row.memory_usage_bytes, row.memory_limit_bytes || row.memory_request_bytes),
        networkRxBytesPerSecond: row.network_rx_rate,
        networkTxBytesPerSecond: row.network_tx_rate,
        sampledAt: row.sampled_at.toISOString()
      }))
    }
  })
}
