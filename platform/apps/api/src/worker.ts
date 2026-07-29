import { setTimeout as wait } from 'node:timers/promises'
import { config } from './config.js'
import { migrateDatabase } from './db/migrate.js'
import { seedPlans } from './db/seed.js'
import { closeDatabase } from './db/pool.js'
import { closeRedis } from './lib/redis.js'
import { withStartupRetry } from './lib/startup-retry.js'
import { runCollectionCycle } from './worker/collector-loop.js'

let stopping = false

async function stop(): Promise<void> {
  if (stopping) return
  stopping = true
  await Promise.allSettled([closeRedis(), closeDatabase()])
}

process.on('SIGTERM', () => void stop())
process.on('SIGINT', () => void stop())

async function main(): Promise<void> {
  await withStartupRetry('database initialization', async () => {
    await migrateDatabase()
    await seedPlans()
  })
  console.log(`[worker] collector started with ${config.WORKER_POLL_SECONDS}s base interval`)
  while (!stopping) {
    const startedAt = Date.now()
    await runCollectionCycle().catch((error) => console.error('[worker] cycle failed', error))
    const remaining = Math.max(1_000, config.WORKER_POLL_SECONDS * 1_000 - (Date.now() - startedAt))
    await wait(remaining)
  }
}

main().catch(async (error) => {
  console.error('[worker] fatal', error)
  await stop()
  process.exitCode = 1
})
