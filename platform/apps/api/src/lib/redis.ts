import Redis, { Cluster } from 'ioredis'
import { config } from '../config.js'

const nodes = config.REDIS_NODES.split(',').map((entry) => {
  const [host, portValue] = entry.trim().split(':')
  return { host: host || 'redis', port: Number(portValue || 6379) }
})

export const redis: Cluster | Redis = config.REDIS_MODE === 'standalone'
  ? new Redis({
      ...nodes[0],
      password: config.REDIS_PASSWORD,
      connectTimeout: 5_000,
      maxRetriesPerRequest: 2,
      enableReadyCheck: true
    })
  : new Redis.Cluster(nodes, {
      redisOptions: {
        password: config.REDIS_PASSWORD,
        connectTimeout: 5_000,
        maxRetriesPerRequest: 2,
        enableReadyCheck: true
      },
      clusterRetryStrategy: (times) => Math.min(100 + times * 200, 2_000),
      slotsRefreshTimeout: 2_000
    })

redis.on('error', (error) => {
  console.error('[redis] cluster error', error.message)
})

export async function closeRedis(): Promise<void> {
  await redis.quit()
}
