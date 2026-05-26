import Database from 'better-sqlite3'
import path from 'path'
import { app } from 'electron'
import type { SystemMetrics, DiskPartition, NetworkInterface } from '../store/types'

const RETENTION_DAYS = 7
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000

export interface MetricsRow {
  id: number
  server_id: string
  timestamp: number
  cpu_percent: number
  load_avg_1: number
  load_avg_5: number
  load_avg_15: number
  mem_total: number
  mem_used: number
  mem_free: number
  mem_percent: number
  disk_json: string      // JSON array of DiskPartition
  network_json: string   // JSON array of NetworkInterface
  uptime: string
}

export interface MetricsHistoryPoint {
  timestamp: number
  cpu: { percent: number; loadAvg: [number, number, number] }
  memory: { total: number; used: number; free: number; percent: number }
  disk: DiskPartition[]
  network: NetworkInterface[]
  uptime: string
}

class MetricsDatabase {
  private db: Database.Database | null = null

  private getDb(): Database.Database {
    if (this.db) return this.db
    const dbPath = path.join(app.getPath('userData'), 'metrics.db')
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.db.pragma('foreign_keys = ON')
    this.initSchema()
    return this.db
  }

  private initSchema(): void {
    const db = this.db!
    db.exec(`
      CREATE TABLE IF NOT EXISTS metrics (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id    TEXT    NOT NULL,
        timestamp    INTEGER NOT NULL,
        cpu_percent  REAL    NOT NULL DEFAULT 0,
        load_avg_1   REAL    NOT NULL DEFAULT 0,
        load_avg_5   REAL    NOT NULL DEFAULT 0,
        load_avg_15  REAL    NOT NULL DEFAULT 0,
        mem_total    INTEGER NOT NULL DEFAULT 0,
        mem_used     INTEGER NOT NULL DEFAULT 0,
        mem_free     INTEGER NOT NULL DEFAULT 0,
        mem_percent  INTEGER NOT NULL DEFAULT 0,
        disk_json    TEXT    NOT NULL DEFAULT '[]',
        network_json TEXT    NOT NULL DEFAULT '[]',
        uptime       TEXT    NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_metrics_server_ts
        ON metrics (server_id, timestamp DESC);
    `)
  }

  insert(metrics: SystemMetrics): void {
    const db = this.getDb()
    const stmt = db.prepare(`
      INSERT INTO metrics
        (server_id, timestamp, cpu_percent,
         load_avg_1, load_avg_5, load_avg_15,
         mem_total, mem_used, mem_free, mem_percent,
         disk_json, network_json, uptime)
      VALUES
        (@server_id, @timestamp, @cpu_percent,
         @load_avg_1, @load_avg_5, @load_avg_15,
         @mem_total, @mem_used, @mem_free, @mem_percent,
         @disk_json, @network_json, @uptime)
    `)
    stmt.run({
      server_id:   metrics.serverId,
      timestamp:   metrics.timestamp,
      cpu_percent: metrics.cpu.percent,
      load_avg_1:  metrics.cpu.loadAvg[0],
      load_avg_5:  metrics.cpu.loadAvg[1],
      load_avg_15: metrics.cpu.loadAvg[2],
      mem_total:   metrics.memory.total,
      mem_used:    metrics.memory.used,
      mem_free:    metrics.memory.free,
      mem_percent: metrics.memory.percent,
      disk_json:    JSON.stringify(metrics.disk),
      network_json: JSON.stringify(metrics.network),
      uptime:       metrics.uptime
    })
  }

  query(serverId: string, hours: number): MetricsHistoryPoint[] {
    const db = this.getDb()
    const since = Date.now() - hours * 60 * 60 * 1000
    const rows = db.prepare(`
      SELECT * FROM metrics
      WHERE server_id = ? AND timestamp >= ?
      ORDER BY timestamp ASC
    `).all(serverId, since) as MetricsRow[]

    return rows.map((r) => ({
      timestamp: r.timestamp,
      cpu: {
        percent: r.cpu_percent,
        loadAvg: [r.load_avg_1, r.load_avg_5, r.load_avg_15] as [number, number, number]
      },
      memory: {
        total: r.mem_total,
        used: r.mem_used,
        free: r.mem_free,
        percent: r.mem_percent
      },
      disk:    JSON.parse(r.disk_json) as DiskPartition[],
      network: JSON.parse(r.network_json) as NetworkInterface[],
      uptime:  r.uptime
    }))
  }

  // Delete rows older than 7 days; called periodically by the monitor
  purgeOld(): void {
    const cutoff = Date.now() - RETENTION_MS
    this.getDb().prepare('DELETE FROM metrics WHERE timestamp < ?').run(cutoff)
  }

  close(): void {
    this.db?.close()
    this.db = null
  }
}

export const metricsDb = new MetricsDatabase()
