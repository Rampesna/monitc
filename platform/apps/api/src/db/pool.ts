import pg from 'pg'
import { config } from '../config.js'

const { Pool, types } = pg

// PostgreSQL int8 values are safe for byte counters within JavaScript's practical range.
types.setTypeParser(20, (value) => Number(value))

export const db = new Pool({
  connectionString: config.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  application_name: 'monitc-api'
})

db.on('error', (error) => {
  console.error('[database] idle client error', error)
})

export async function closeDatabase(): Promise<void> {
  await db.end()
}
