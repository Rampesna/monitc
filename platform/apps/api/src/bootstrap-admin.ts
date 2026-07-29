import { config } from './config.js'
import { migrateDatabase } from './db/migrate.js'
import { seedPlans } from './db/seed.js'
import { closeDatabase } from './db/pool.js'
import { withStartupRetry } from './lib/startup-retry.js'
import { ensureBootstrapAdmin } from './services/bootstrap-admin.js'

async function main(): Promise<void> {
  await withStartupRetry('database initialization', async () => {
    await migrateDatabase()
    await seedPlans()
    await ensureBootstrapAdmin(config.BOOTSTRAP_ADMIN_EMAIL, config.BOOTSTRAP_ADMIN_PASSWORD)
  })
  await closeDatabase()
}

main().catch(async (error) => {
  console.error('[bootstrap-admin] failed', error)
  await closeDatabase().catch(() => undefined)
  process.exitCode = 1
})
