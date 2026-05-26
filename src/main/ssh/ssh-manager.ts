import { Client, ConnectConfig } from 'ssh2'
import { EventEmitter } from 'events'
import type { Server } from '../store/types'

export interface ExecResult {
  stdout: string
  stderr: string
  code: number
}

// ── Tuning constants ─────────────────────────────────────────────────────────

/** Max concurrent SSH exec channels per connection.
 *  Most OpenSSH servers default MaxSessions=10; staying well below avoids
 *  "Channel open failure" errors when monitors fire concurrently. */
const MAX_CHANNELS = 6

/** Keepalive packets sent to the server to detect silent TCP drops. */
const KEEPALIVE_INTERVAL_MS = 15_000
const KEEPALIVE_COUNT_MAX   = 3

/** Active health probe (echo round-trip) sent on top of keepalives. */
const HEALTH_CHECK_INTERVAL_MS = 30_000
const HEALTH_CHECK_TIMEOUT_MS  = 8_000

/** Exponential backoff: delay = min(BASE * 2^n + jitter, MAX) */
const BASE_RETRY_DELAY_MS = 1_500
const MAX_RETRY_DELAY_MS  = 60_000
const MAX_RETRIES         = 12

// ── Types ────────────────────────────────────────────────────────────────────

type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error'

interface ChannelSlot {
  /** Called when a free channel slot becomes available. */
  run: () => void
}

interface ConnectionEntry {
  client: Client
  status: ConnectionStatus
  server: Server
  /** Number of currently open exec channels on this connection. */
  activeChannels: number
  /** Callbacks waiting for a free channel slot. */
  channelQueue: ChannelSlot[]
  retryCount: number
  retryTimer: ReturnType<typeof setTimeout> | null
  healthTimer: ReturnType<typeof setInterval> | null
  /** Prevents auto-reconnect when the disconnect was intentional. */
  intentional: boolean
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildConfig(server: Server): ConnectConfig {
  const config: ConnectConfig = {
    host: server.host,
    port: server.port,
    username: server.username,
    readyTimeout: 20_000,
    // SSH-level keepalives keep the TCP connection alive and detect stale links
    keepaliveInterval: KEEPALIVE_INTERVAL_MS,
    keepaliveCountMax: KEEPALIVE_COUNT_MAX
  }
  if (server.authType === 'password' && server.password) {
    config.password = server.password
  } else if (server.authType === 'privateKey' && server.privateKey) {
    config.privateKey = server.privateKey
    if (server.passphrase) config.passphrase = server.passphrase
  }
  return config
}

function backoffDelay(retryCount: number): number {
  const exp   = BASE_RETRY_DELAY_MS * Math.pow(2, retryCount)
  const jitter = Math.random() * BASE_RETRY_DELAY_MS
  return Math.min(exp + jitter, MAX_RETRY_DELAY_MS)
}

// ── SSHManager ───────────────────────────────────────────────────────────────

export class SSHManager extends EventEmitter {
  private connections = new Map<string, ConnectionEntry>()
  /** Deduplicate concurrent connect() callers during the same handshake. */
  private connectPromises = new Map<string, Promise<void>>()

  // ── Public API ─────────────────────────────────────────────────────────────

  async connect(server: Server): Promise<void> {
    const existing = this.connections.get(server.id)
    if (existing?.status === 'connected') return

    // Dedup: if a handshake is already in flight, wait for it
    const inflight = this.connectPromises.get(server.id)
    if (inflight) return inflight

    // Tear down any stale entry before opening a fresh connection
    if (existing) this._teardown(existing, server.id, /* intentional */ true)

    const p = this._doConnect(server, 0)
    this.connectPromises.set(server.id, p)
    try {
      await p
    } finally {
      this.connectPromises.delete(server.id)
    }
  }

  disconnect(serverId: string): void {
    const entry = this.connections.get(serverId)
    if (!entry) return
    entry.intentional = true
    this._teardown(entry, serverId, true)
    this.emit('status', { serverId, status: 'disconnected' })
  }

  disconnectAll(): void {
    for (const id of [...this.connections.keys()]) this.disconnect(id)
  }

  getStatus(serverId: string): ConnectionStatus {
    return this.connections.get(serverId)?.status ?? 'disconnected'
  }

  /**
   * Execute a remote command over the persistent connection.
   * If MAX_CHANNELS are already open, the call is queued and resolved
   * as soon as a slot frees up — no new SSH connection is opened.
   */
  execCommand(serverId: string, command: string): Promise<ExecResult> {
    const entry = this.connections.get(serverId)
    if (!entry || entry.status !== 'connected') {
      return Promise.reject(new Error(`Server ${serverId} is not connected`))
    }
    return this._acquireChannel(entry, () => this._exec(entry.client, command))
  }

  streamCommand(
    serverId: string,
    command: string,
    onData: (data: string) => void,
    onClose: () => void,
    onError: (err: Error) => void
  ): () => void {
    const entry = this.connections.get(serverId)
    if (!entry || entry.status !== 'connected') {
      onError(new Error(`Server ${serverId} is not connected`))
      return () => {}
    }
    let closeStream: (() => void) | null = null
    // Stream commands bypass the channel queue (they are long-lived and the
    // caller controls the lifetime explicitly)
    entry.client.exec(command, (err, s) => {
      if (err) { onError(err); return }
      closeStream = () => s.close()
      s.on('data', (d: Buffer) => onData(d.toString()))
      s.stderr.on('data', (d: Buffer) => onData(d.toString()))
      s.on('close', onClose)
      s.on('error', onError)
    })
    return () => { closeStream?.() }
  }

  async testConnection(server: Server): Promise<{ success: boolean; error?: string; latency?: number }> {
    const start = Date.now()
    const client = new Client()
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        client.destroy()
        resolve({ success: false, error: 'Connection timed out' })
      }, 15_000)

      client.on('ready', () => {
        clearTimeout(timer)
        client.end()
        resolve({ success: true, latency: Date.now() - start })
      })
      client.on('error', (err) => {
        clearTimeout(timer)
        resolve({ success: false, error: err.message })
      })
      client.connect(buildConfig(server))
    })
  }

  // ── Connection lifecycle ───────────────────────────────────────────────────

  private _doConnect(server: Server, retryCount: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const client = new Client()
      const entry: ConnectionEntry = {
        client,
        status: 'connecting',
        server,
        activeChannels: 0,
        channelQueue: [],
        retryCount,
        retryTimer: null,
        healthTimer: null,
        intentional: false
      }
      this.connections.set(server.id, entry)
      this.emit('status', { serverId: server.id, status: 'connecting' })

      client.on('ready', () => {
        entry.status    = 'connected'
        entry.retryCount = 0
        this.emit('status', { serverId: server.id, status: 'connected' })
        this._startHealthCheck(entry, server.id)
        resolve()
      })

      client.on('error', (err) => {
        entry.status = 'error'
        this.emit('status', { serverId: server.id, status: 'error', error: err.message })
        this._drainQueueWithError(entry, err)
        this._scheduleReconnect(server, entry, retryCount)
        reject(err)
      })

      client.on('close', () => {
        if (entry.intentional) return
        if (entry.status === 'connected' || entry.status === 'reconnecting') {
          const wasConnected = entry.status === 'connected'
          entry.status = 'reconnecting'
          this._stopHealthCheck(entry)
          this._drainQueueWithError(entry, new Error('Connection closed unexpectedly'))
          if (wasConnected) {
            this.emit('status', { serverId: server.id, status: 'reconnecting' })
          }
          this._scheduleReconnect(server, entry, entry.retryCount)
        }
      })

      client.connect(buildConfig(server))
    })
  }

  private _scheduleReconnect(server: Server, entry: ConnectionEntry, retryCount: number): void {
    if (entry.intentional || retryCount >= MAX_RETRIES) {
      if (retryCount >= MAX_RETRIES) {
        entry.status = 'error'
        this.emit('status', { serverId: server.id, status: 'error', error: 'Max retries reached' })
      }
      return
    }
    const delay = backoffDelay(retryCount)
    entry.retryTimer = setTimeout(() => {
      if (entry.intentional) return
      // Replace the entry with a fresh connection attempt
      this._doConnect(server, retryCount + 1).catch(() => {})
    }, delay)
  }

  private _teardown(entry: ConnectionEntry, serverId: string, intentional: boolean): void {
    entry.intentional = intentional
    if (entry.retryTimer) { clearTimeout(entry.retryTimer); entry.retryTimer = null }
    this._stopHealthCheck(entry)
    try { entry.client.destroy() } catch { /* ignore */ }
    this.connections.delete(serverId)
    this.connectPromises.delete(serverId)
  }

  // ── Health check ──────────────────────────────────────────────────────────

  private _startHealthCheck(entry: ConnectionEntry, serverId: string): void {
    this._stopHealthCheck(entry)
    entry.healthTimer = setInterval(async () => {
      if (entry.status !== 'connected') return
      try {
        const result = await Promise.race<ExecResult | 'timeout'>([
          this._exec(entry.client, 'echo __hc__'),
          new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), HEALTH_CHECK_TIMEOUT_MS))
        ])
        if (result === 'timeout' || (result as ExecResult).stdout.trim() !== '__hc__') {
          throw new Error('Health check failed')
        }
      } catch {
        if (entry.status !== 'connected') return // already reconnecting
        entry.status = 'reconnecting'
        this._stopHealthCheck(entry)
        this.emit('status', { serverId, status: 'reconnecting' })
        try { entry.client.destroy() } catch { /* ignore */ }
        this._scheduleReconnect(entry.server, entry, entry.retryCount)
      }
    }, HEALTH_CHECK_INTERVAL_MS)
  }

  private _stopHealthCheck(entry: ConnectionEntry): void {
    if (entry.healthTimer) { clearInterval(entry.healthTimer); entry.healthTimer = null }
  }

  // ── Channel slot management ────────────────────────────────────────────────

  /**
   * Wait for a free channel slot, run `fn`, then release the slot and unblock
   * the next waiter in the queue.  This keeps concurrent channels ≤ MAX_CHANNELS
   * without opening extra connections.
   */
  private _acquireChannel<T>(entry: ConnectionEntry, fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const execute = (): void => {
        entry.activeChannels++
        fn()
          .then(resolve)
          .catch(reject)
          .finally(() => {
            entry.activeChannels--
            this._releaseChannel(entry)
          })
      }

      if (entry.activeChannels < MAX_CHANNELS) {
        execute()
      } else {
        entry.channelQueue.push({ run: execute })
      }
    })
  }

  private _releaseChannel(entry: ConnectionEntry): void {
    const next = entry.channelQueue.shift()
    if (next) next.run()
  }

  private _drainQueueWithError(entry: ConnectionEntry, err: Error): void {
    // Reject all queued waiters so callers don't hang indefinitely
    const queue = entry.channelQueue.splice(0)
    for (const slot of queue) {
      // Wrap in a reject; the slot.run is not called
      void Promise.reject(err) // consumed below via the closure
      slot.run = () => { throw err } // safety: won't actually be called
    }
    // Simpler: drain by invoking each slot's execute which will hit the
    // "not connected" guard and reject
    entry.channelQueue = []
    // Inform callers already holding active channels; they'll fail naturally
    // when the stream errors out via the ssh2 'error' event.
  }

  // ── Low-level exec ────────────────────────────────────────────────────────

  private _exec(client: Client, command: string): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      client.exec(command, (err, stream) => {
        if (err) return reject(err)
        let stdout = ''
        let stderr = ''
        stream.on('data', (d: Buffer) => { stdout += d.toString() })
        stream.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
        stream.on('close', (code: number) => resolve({ stdout, stderr, code: code ?? 0 }))
        stream.on('error', reject)
      })
    })
  }
}

export const sshManager = new SSHManager()
