import { config } from './config.js'
import { buildApp } from './app.js'
import { migrateDatabase } from './db/migrate.js'
import { seedPlans } from './db/seed.js'
import { closeDatabase } from './db/pool.js'
import { closeRedis } from './lib/redis.js'
import { withStartupRetry } from './lib/startup-retry.js'
import { ensureBootstrapAdmin } from './services/bootstrap-admin.js'

async function main(): Promise<void> {
  await withStartupRetry('database initialization', async () => {
    await migrateDatabase()
    await seedPlans()
    await ensureBootstrapAdmin(config.BOOTSTRAP_ADMIN_EMAIL, config.BOOTSTRAP_ADMIN_PASSWORD)
  })
  const app = await buildApp()

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down')
    await app.close()
    await Promise.allSettled([closeRedis(), closeDatabase()])
  }
  process.once('SIGTERM', () => void shutdown('SIGTERM'))
  process.once('SIGINT', () => void shutdown('SIGINT'))

  await app.listen({ host: '0.0.0.0', port: config.PORT })
}

main().catch(async (error) => {
  console.error('[api] fatal', error)
  await Promise.allSettled([closeRedis(), closeDatabase()])
  process.exitCode = 1
})
