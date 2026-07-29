import { config } from '../config.js'
import { db } from '../db/pool.js'
import { redis } from '../lib/redis.js'
import { decryptVaultSecret, encryptVaultSecret } from '../lib/vault.js'
import { collectServer } from '../services/ssh-collector.js'
import { evaluateSystemAlerts } from '../services/alert-evaluator.js'

interface ServerWorkItem {
  id: string
  workspace_id: string
  secret_ciphertext: string
  secret_key_id: string
  minimum_poll_seconds: number
  retention_days: number
  last_seen_at: Date | null
}

interface PreviousSystem {
  sampled_at: Date
  network_rx_total: number
  network_tx_total: number
}

interface PreviousPod {
  namespace: string
  pod_name: string
  sampled_at: Date
  network_rx_total: number
  network_tx_total: number
}

function rate(current: number, previous: number, elapsedSeconds: number): number {
  if (elapsedSeconds <= 0 || current < previous) return 0
  return Math.max(0, (current - previous) / elapsedSeconds)
}

function safeErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : 'UNKNOWN'
  if (message.includes('Authentication')) return 'SSH_AUTH_FAILED'
  if (message.includes('fingerprint') || message.includes('Host denied')) return 'SSH_HOST_KEY_FAILED'
  if (message.includes('TIMEOUT') || message.includes('timed out')) return 'SSH_TIMEOUT'
  if (message.includes('PRIVATE_TARGET')) return 'TARGET_POLICY_BLOCKED'
  if (message.includes('ECONNREFUSED')) return 'SSH_REFUSED'
  return /^[A-Z0-9_]+$/.test(message) ? message.slice(0, 80) : 'COLLECTION_FAILED'
}

async function acquireLock(serverId: string): Promise<string | null> {
  const token = `${process.pid}:${Date.now()}`
  const result = await redis.set(`collector:${serverId}`, token, 'PX', 120_000, 'NX')
  return result === 'OK' ? token : null
}

async function releaseLock(serverId: string, token: string): Promise<void> {
  await redis.eval(
    `if redis.call("get", KEYS[1]) == ARGV[1] then
       return redis.call("del", KEYS[1])
     end
     return 0`,
    1,
    `collector:${serverId}`,
    token
  )
}

async function collectOne(item: ServerWorkItem): Promise<void> {
  if (
    item.last_seen_at &&
    Date.now() - new Date(item.last_seen_at).getTime() < item.minimum_poll_seconds * 1_000 * 0.8
  ) {
    return
  }
  const lock = await acquireLock(item.id)
  if (!lock) return

  try {
    const secret = await decryptVaultSecret(item.secret_ciphertext, item.secret_key_id)
    const collectedAt = new Date()
    const snapshot = await collectServer(secret)
    const previousSystemResult = await db.query<PreviousSystem>(
      `SELECT sampled_at, network_rx_total, network_tx_total
       FROM system_metric_samples
       WHERE workspace_id = $1 AND server_id = $2
       ORDER BY sampled_at DESC LIMIT 1`,
      [item.workspace_id, item.id]
    )
    const previousSystem = previousSystemResult.rows[0]
    const systemElapsed = previousSystem
      ? Math.max(1, (collectedAt.getTime() - new Date(previousSystem.sampled_at).getTime()) / 1000)
      : 0
    const systemRxRate = previousSystem
      ? rate(snapshot.system.networkRxTotal, previousSystem.network_rx_total, systemElapsed)
      : 0
    const systemTxRate = previousSystem
      ? rate(snapshot.system.networkTxTotal, previousSystem.network_tx_total, systemElapsed)
      : 0

    const previousPodsResult = await db.query<PreviousPod>(
      `SELECT DISTINCT ON (namespace, pod_name)
         namespace, pod_name, sampled_at, network_rx_total, network_tx_total
       FROM kubernetes_pod_samples
       WHERE workspace_id = $1 AND server_id = $2
       ORDER BY namespace, pod_name, sampled_at DESC`,
      [item.workspace_id, item.id]
    )
    const previousPods = new Map(
      previousPodsResult.rows.map((row) => [`${row.namespace}/${row.pod_name}`, row])
    )

    const client = await db.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `INSERT INTO system_metric_samples
          (workspace_id, server_id, sampled_at, cpu_percent, memory_percent, disk_percent,
           network_rx_total, network_tx_total, network_rx_rate, network_tx_rate, uptime_seconds)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          item.workspace_id,
          item.id,
          collectedAt,
          snapshot.system.cpuPercent,
          snapshot.system.memoryPercent,
          snapshot.system.diskPercent,
          snapshot.system.networkRxTotal,
          snapshot.system.networkTxTotal,
          systemRxRate,
          systemTxRate,
          snapshot.system.uptimeSeconds
        ]
      )

      for (const pod of snapshot.pods) {
        const previous = previousPods.get(`${pod.namespace}/${pod.name}`)
        const elapsed = previous
          ? Math.max(1, (collectedAt.getTime() - new Date(previous.sampled_at).getTime()) / 1000)
          : 0
        const rxRate = previous ? rate(pod.networkRxTotal, previous.network_rx_total, elapsed) : 0
        const txRate = previous ? rate(pod.networkTxTotal, previous.network_tx_total, elapsed) : 0
        await client.query(
          `INSERT INTO kubernetes_pod_samples
            (workspace_id, server_id, namespace, pod_name, node_name, phase, ready, restarts,
             cpu_usage_millicores, cpu_request_millicores, cpu_limit_millicores,
             memory_usage_bytes, memory_request_bytes, memory_limit_bytes,
             network_rx_total, network_tx_total, network_rx_rate, network_tx_rate, sampled_at)
           VALUES
            ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
          [
            item.workspace_id,
            item.id,
            pod.namespace,
            pod.name,
            pod.node,
            pod.phase,
            pod.ready,
            pod.restarts,
            pod.cpuUsageMillicores,
            pod.cpuRequestMillicores,
            pod.cpuLimitMillicores,
            pod.memoryUsageBytes,
            pod.memoryRequestBytes,
            pod.memoryLimitBytes,
            pod.networkRxTotal,
            pod.networkTxTotal,
            rxRate,
            txRate,
            collectedAt
          ]
        )
      }

      let ciphertext = item.secret_ciphertext
      if (!secret.hostFingerprint) {
        secret.hostFingerprint = snapshot.fingerprint
        ciphertext = await encryptVaultSecret(secret)
      }
      await client.query(
        `UPDATE server_connections SET
           secret_ciphertext = $1,
           status = 'connected',
           last_seen_at = $2,
           last_error_code = NULL,
           updated_at = now()
         WHERE id = $3`,
        [ciphertext, collectedAt, item.id]
      )
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }

    await redis.publish(
      `metrics:${item.workspace_id}`,
      JSON.stringify({ serverId: item.id, sampledAt: collectedAt.toISOString() })
    )
    await evaluateSystemAlerts({
      workspaceId: item.workspace_id,
      serverId: item.id,
      sampledAt: collectedAt,
      minimumPollSeconds: item.minimum_poll_seconds,
      values: {
        cpu: snapshot.system.cpuPercent,
        memory: snapshot.system.memoryPercent,
        disk: snapshot.system.diskPercent,
        network_rx: systemRxRate,
        network_tx: systemTxRate
      }
    }).catch((error) => {
      console.warn(`[collector] alert evaluation failed for ${item.id}`, error)
    })
  } catch (error) {
    const code = safeErrorCode(error)
    console.warn(`[collector] server ${item.id} failed with ${code}`)
    await db.query(
      `UPDATE server_connections SET
         status = CASE WHEN last_seen_at IS NULL THEN 'offline' ELSE 'degraded' END,
         last_error_code = $1,
         last_error_at = now(),
         updated_at = now()
       WHERE id = $2`,
      [code, item.id]
    )
  } finally {
    await releaseLock(item.id, lock).catch(() => undefined)
  }
}

async function loadWork(): Promise<ServerWorkItem[]> {
  const result = await db.query<ServerWorkItem>(
    `SELECT sc.id, sc.workspace_id, sc.secret_ciphertext, sc.secret_key_id, sc.last_seen_at,
       COALESCE((p.entitlements->>'minimumPollSeconds')::int, 60) AS minimum_poll_seconds,
       COALESCE((p.entitlements->>'retentionDays')::int, 1) AS retention_days
     FROM server_connections sc
     JOIN subscriptions s ON s.workspace_id = sc.workspace_id AND s.status IN ('active', 'trialing')
     JOIN plans p ON p.code = s.plan_code
     WHERE sc.connection_mode = 'ssh'
     ORDER BY sc.last_seen_at ASC NULLS FIRST`
  )
  return result.rows
}

async function cleanRetention(): Promise<void> {
  await db.query(`
    DELETE FROM system_metric_samples sample
    USING subscriptions subscription, plans plan
    WHERE subscription.workspace_id = sample.workspace_id
      AND plan.code = subscription.plan_code
      AND sample.sampled_at < now() - (
        COALESCE((plan.entitlements->>'retentionDays')::int, 1)::text || ' days'
      )::interval
  `)
  await db.query(`
    DELETE FROM kubernetes_pod_samples sample
    USING subscriptions subscription, plans plan
    WHERE subscription.workspace_id = sample.workspace_id
      AND plan.code = subscription.plan_code
      AND sample.sampled_at < now() - (
        COALESCE((plan.entitlements->>'retentionDays')::int, 1)::text || ' days'
      )::interval
  `)
  await db.query('DELETE FROM refresh_sessions WHERE expires_at < now() - interval \'7 days\'')
}

let cleanupCounter = 0

export async function runCollectionCycle(): Promise<void> {
  const work = await loadWork()
  const concurrency = 5
  for (let index = 0; index < work.length; index += concurrency) {
    await Promise.all(work.slice(index, index + concurrency).map(collectOne))
  }
  cleanupCounter += 1
  if (cleanupCounter >= Math.max(1, Math.round(3600 / config.WORKER_POLL_SECONDS))) {
    cleanupCounter = 0
    await cleanRetention()
  }
}
