import { config } from './config.js'
import { migrateDatabase } from './db/migrate.js'
import { seedPlans } from './db/seed.js'
import { closeDatabase } from './db/pool.js'
import { ensureBootstrapAdmin } from './services/bootstrap-admin.js'

async function main(): Promise<void> {
  await migrateDatabase()
  await seedPlans()
  await ensureBootstrapAdmin(config.BOOTSTRAP_ADMIN_EMAIL, config.BOOTSTRAP_ADMIN_PASSWORD)
  await closeDatabase()
}

main().catch((error) => {
  console.error('[bootstrap-admin] failed', error)
  process.exitCode = 1
})
