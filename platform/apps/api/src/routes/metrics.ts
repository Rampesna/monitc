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
    const server = await db.query<{ connection_mode: 'ssh' | 'agent' }>(
      'SELECT connection_mode FROM server_connections WHERE id = $1 AND workspace_id = $2',
      [id.data, request.auth.workspaceId]
    )
    if (!server.rowCount) return reply.code(404).send({ error: 'server_not_found' })
    const useRollup = server.rows[0]?.connection_mode === 'agent' && query.data.hours > 1
    const result = useRollup ? await db.query<{
      sampled_at: Date
      cpu_percent: number
      memory_percent: number
      disk_percent: number
      network_rx_rate: number
      network_tx_rate: number
    }>(
      `SELECT bucket_at AS sampled_at, cpu_average AS cpu_percent,
         memory_average AS memory_percent, disk_average AS disk_percent,
         network_rx_rate_average AS network_rx_rate,
         network_tx_rate_average AS network_tx_rate
       FROM system_metric_rollups_1m
       WHERE workspace_id = $1 AND server_id = $2
         AND bucket_at >= now() - ($3::text || ' hours')::interval
       ORDER BY bucket_at ASC
       LIMIT 2000`,
      [request.auth.workspaceId, id.data, query.data.hours]
    ) : await db.query<{
      sampled_at: Date
      cpu_percent: number
      memory_percent: number
      disk_percent: number
      network_rx_rate: number
      network_tx_rate: number
    }>(
      `SELECT sampled_at, cpu_percent, memory_percent, disk_percent, network_rx_rate, network_tx_rate
       FROM (
         SELECT sampled_at, cpu_percent, memory_percent, disk_percent, network_rx_rate, network_tx_rate
         FROM system_metric_samples
         WHERE workspace_id = $1 AND server_id = $2
           AND sampled_at >= now() - ($3::text || ' hours')::interval
         ORDER BY sampled_at DESC
         LIMIT 2000
       ) recent
       ORDER BY sampled_at ASC`,
      [request.auth.workspaceId, id.data, query.data.hours]
    )
    return {
      points: result.rows.map((row) => ({
        timestamp: row.sampled_at.toISOString(),
        cpuPercent: row.cpu_percent,
        memoryPercent: row.memory_percent,
        diskPercent: row.disk_percent,
        networkRxBytesPerSecond: row.network_rx_rate,
        networkTxBytesPerSecond: row.network_tx_rate,
        source: useRollup ? 'rollup' : server.rows[0]?.connection_mode
      })),
      resolution: useRollup ? '1m' : 'raw'
    }
  })

  app.get('/:id/latest', { preHandler: requireScope('metrics:read') }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'unauthorized' })
    const id = idSchema.safeParse((request.params as { id?: string }).id)
    if (!id.success) return reply.code(400).send({ error: 'validation_error' })
    const result = await db.query<{
      sampled_at: Date
      cpu_percent: number
      memory_percent: number
      disk_percent: number
      network_rx_rate: number
      network_tx_rate: number
      sample_source: 'ssh' | 'agent'
      sample_interval_nanos: number | null
      collection_duration_nanos: number | null
      monotonic_nanos: string | null
      ebpf_active: boolean
      scheduler_switches: number
      tcp_retransmits: number
      load_average_1: number
      load_average_5: number
      load_average_15: number
    }>(
      `SELECT sample.sampled_at, sample.cpu_percent, sample.memory_percent, sample.disk_percent,
         sample.network_rx_rate, sample.network_tx_rate, sample.sample_source,
         sample.sample_interval_nanos, sample.collection_duration_nanos, sample.monotonic_nanos,
         sample.ebpf_active, sample.scheduler_switches, sample.tcp_retransmits,
         sample.load_average_1, sample.load_average_5, sample.load_average_15
       FROM system_metric_samples sample
       JOIN server_connections server ON server.id = sample.server_id
       WHERE sample.server_id = $1 AND sample.workspace_id = $2 AND server.workspace_id = $2
       ORDER BY sample.sampled_at DESC LIMIT 1`,
      [id.data, request.auth.workspaceId]
    )
    const row = result.rows[0]
    if (!row) return reply.code(404).send({ error: 'metric_sample_not_found' })
    return {
      timestamp: row.sampled_at.toISOString(),
      cpuPercent: row.cpu_percent,
      memoryPercent: row.memory_percent,
      diskPercent: row.disk_percent,
      networkRxBytesPerSecond: row.network_rx_rate,
      networkTxBytesPerSecond: row.network_tx_rate,
      source: row.sample_source,
      sampleIntervalNanos: Number(row.sample_interval_nanos || 0),
      collectionDurationNanos: Number(row.collection_duration_nanos || 0),
      monotonicNanos: row.monotonic_nanos,
      ebpfActive: row.ebpf_active,
      schedulerSwitches: Number(row.scheduler_switches),
      tcpRetransmits: Number(row.tcp_retransmits),
      loadAverage1: row.load_average_1,
      loadAverage5: row.load_average_5,
      loadAverage15: row.load_average_15
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

  app.get('/:id/containers', { preHandler: requireScope('metrics:read') }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'unauthorized' })
    const id = idSchema.safeParse((request.params as { id?: string }).id)
    if (!id.success) return reply.code(400).send({ error: 'validation_error' })
    const server = await db.query(
      'SELECT 1 FROM server_connections WHERE id = $1 AND workspace_id = $2',
      [id.data, request.auth.workspaceId]
    )
    if (!server.rowCount) return reply.code(404).send({ error: 'server_not_found' })
    const result = await db.query<{
      container_id: string
      container_name: string
      image: string
      state: string
      status: string
      cpu_percent: number
      memory_usage_bytes: number
      memory_limit_bytes: number
      network_rx_rate: number
      network_tx_rate: number
      sampled_at: Date
    }>(
      `SELECT DISTINCT ON (container_id)
        container_id, container_name, image, state, status, cpu_percent,
        memory_usage_bytes, memory_limit_bytes, network_rx_rate, network_tx_rate, sampled_at
       FROM docker_container_samples
       WHERE workspace_id = $1 AND server_id = $2
       ORDER BY container_id, sampled_at DESC`,
      [request.auth.workspaceId, id.data]
    )
    return {
      containers: result.rows.map((row) => ({
        id: row.container_id,
        name: row.container_name,
        image: row.image,
        state: row.state,
        status: row.status,
        cpuPercent: row.cpu_percent,
        memoryUsageBytes: row.memory_usage_bytes,
        memoryLimitBytes: row.memory_limit_bytes,
        memoryUsagePercent: percent(row.memory_usage_bytes, row.memory_limit_bytes),
        networkRxBytesPerSecond: row.network_rx_rate,
        networkTxBytesPerSecond: row.network_tx_rate,
        sampledAt: row.sampled_at.toISOString()
      }))
    }
  })
}
