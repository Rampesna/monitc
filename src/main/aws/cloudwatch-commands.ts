import {
  GetMetricStatisticsCommand,
  type Datapoint
} from '@aws-sdk/client-cloudwatch'
import { awsManager } from './aws-manager'

export interface MetricDataPoint {
  timestamp: number
  value: number
}

type EC2MetricName =
  | 'CPUUtilization'
  | 'NetworkIn'
  | 'NetworkOut'
  | 'DiskReadOps'
  | 'DiskWriteOps'

const VALID_METRICS: EC2MetricName[] = [
  'CPUUtilization',
  'NetworkIn',
  'NetworkOut',
  'DiskReadOps',
  'DiskWriteOps'
]

/**
 * Fetch CloudWatch EC2 metric data for the specified instance.
 *
 * @param accountId  - Registered AWS account ID
 * @param instanceId - EC2 instance ID (i-xxxxx)
 * @param metricName - One of: CPUUtilization, NetworkIn, NetworkOut, DiskReadOps, DiskWriteOps
 * @param hours      - Number of hours of history to retrieve (1–168)
 * @returns Time series sorted by timestamp ascending
 */
export async function getEC2Metrics(
  accountId: string,
  instanceId: string,
  metricName: string,
  hours: number
): Promise<MetricDataPoint[]> {
  if (!VALID_METRICS.includes(metricName as EC2MetricName)) {
    throw new Error(`Invalid metric name "${metricName}". Must be one of: ${VALID_METRICS.join(', ')}`)
  }

  const clampedHours = Math.min(Math.max(1, hours), 168)
  const now = new Date()
  const startTime = new Date(now.getTime() - clampedHours * 60 * 60 * 1000)

  // Choose an appropriate period based on the requested time range
  // ≤6h → 60s, ≤24h → 300s, ≤72h → 900s, >72h → 3600s
  let period: number
  if (clampedHours <= 6)       period = 60
  else if (clampedHours <= 24) period = 300
  else if (clampedHours <= 72) period = 900
  else                         period = 3600

  const client = awsManager.getCloudWatchClient(accountId)
  const response = await client.send(new GetMetricStatisticsCommand({
    Namespace:  'AWS/EC2',
    MetricName: metricName,
    Dimensions: [{ Name: 'InstanceId', Value: instanceId }],
    StartTime:  startTime,
    EndTime:    now,
    Period:     period,
    Statistics: ['Average']
  }))

  const datapoints: MetricDataPoint[] = (response.Datapoints ?? [])
    .filter((dp): dp is Datapoint & { Timestamp: Date; Average: number } =>
      dp.Timestamp != null && dp.Average != null
    )
    .map((dp) => ({
      timestamp: dp.Timestamp.getTime(),
      value:     dp.Average
    }))
    .sort((a, b) => a.timestamp - b.timestamp)

  return datapoints
}
