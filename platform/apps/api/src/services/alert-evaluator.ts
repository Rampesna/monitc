import { db } from '../db/pool.js'

interface AlertRuleRow {
  id: string
  metric: keyof MetricValues
  operator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq'
  threshold: number
  duration_seconds: number
  cooldown_seconds: number
}

interface MetricValues {
  cpu: number
  memory: number
  disk: number
  network_rx: number
  network_tx: number
}

const columns: Record<keyof MetricValues, string> = {
  cpu: 'cpu_percent',
  memory: 'memory_percent',
  disk: 'disk_percent',
  network_rx: 'network_rx_rate',
  network_tx: 'network_tx_rate'
}

const operators: Record<AlertRuleRow['operator'], string> = {
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  eq: '='
}

function matches(value: number, operator: AlertRuleRow['operator'], threshold: number): boolean {
  if (operator === 'gt') return value > threshold
  if (operator === 'gte') return value >= threshold
  if (operator === 'lt') return value < threshold
  if (operator === 'lte') return value <= threshold
  return value === threshold
}

export async function evaluateSystemAlerts(input: {
  workspaceId: string
  serverId: string
  sampledAt: Date
  minimumPollSeconds: number
  values: MetricValues
}): Promise<void> {
  const rules = await db.query<AlertRuleRow>(
    `SELECT id, metric, operator, threshold, duration_seconds, cooldown_seconds
     FROM alert_rules
     WHERE workspace_id = $1 AND enabled = true AND (server_id IS NULL OR server_id = $2)`,
    [input.workspaceId, input.serverId]
  )

  for (const rule of rules.rows) {
    const value = input.values[rule.metric]
    if (!Number.isFinite(value) || !matches(value, rule.operator, rule.threshold)) {
      await db.query(
        `UPDATE alert_events SET status = 'resolved', resolved_at = $1
         WHERE workspace_id = $2 AND rule_id = $3 AND server_id = $4 AND status = 'open'`,
        [input.sampledAt, input.workspaceId, rule.id, input.serverId]
      )
      continue
    }

    let sustained = rule.duration_seconds === 0
    if (!sustained) {
      const column = columns[rule.metric]
      const operator = operators[rule.operator]
      const history = await db.query<{ oldest: Date | null; sustained: boolean | null }>(
        `SELECT min(sampled_at) AS oldest, bool_and(${column} ${operator} $1) AS sustained
         FROM system_metric_samples
         WHERE workspace_id = $2 AND server_id = $3
           AND sampled_at >= $4 - ($5::text || ' seconds')::interval`,
        [rule.threshold, input.workspaceId, input.serverId, input.sampledAt, rule.duration_seconds]
      )
      const oldest = history.rows[0]?.oldest
      const coverageStart = input.sampledAt.getTime() - rule.duration_seconds * 1000
      const tolerance = Math.max(2, Math.min(5, input.minimumPollSeconds * 0.25)) * 1000
      sustained = Boolean(
        history.rows[0]?.sustained &&
        oldest &&
        new Date(oldest).getTime() <= coverageStart + tolerance
      )
    }
    if (!sustained) continue

    const recent = await db.query(
      `SELECT 1 FROM alert_events
       WHERE workspace_id = $1 AND rule_id = $2 AND server_id = $3
         AND (status = 'open' OR triggered_at >= $4 - ($5::text || ' seconds')::interval)
       LIMIT 1`,
      [input.workspaceId, rule.id, input.serverId, input.sampledAt, rule.cooldown_seconds]
    )
    if (recent.rowCount) continue
    await db.query(
      `INSERT INTO alert_events (workspace_id, rule_id, server_id, value, triggered_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [input.workspaceId, rule.id, input.serverId, value, input.sampledAt]
    )
  }
}
