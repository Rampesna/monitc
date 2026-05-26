import { Client, ConnectConfig } from 'ssh2'
import { EventEmitter } from 'events'
import type { Server } from '../store/types'

interface ExecResult {
  stdout: string
  stderr: string
  code: number
}

interface ConnectionEntry {
  client: Client
  status: 'connected' | 'connecting' | 'disconnected' | 'error'
  retryCount: number
  retryTimer: ReturnType<typeof setTimeout> | null
  server: Server
}

const MAX_RETRIES = 5
const BASE_RETRY_DELAY = 2000

export class SSHManager extends EventEmitter {
  private connections = new Map<string, ConnectionEntry>()
  private connectPromises = new Map<string, Promise<void>>()

  async connect(server: Server): Promise<void> {
    const existing = this.connections.get(server.id)
    if (existing?.status === 'connected') return

    const pending = this.connectPromises.get(server.id)
    if (pending) return pending

    if (existing && existing.status !== 'connected') {
      if (existing.retryTimer) clearTimeout(existing.retryTimer)
      existing.client.destroy()
      this.connections.delete(server.id)
    }

    const promise = this.doConnect(server, 0)
    this.connectPromises.set(server.id, promise)
    try {
      await promise
    } finally {
      this.connectPromises.delete(server.id)
    }
  }

  private doConnect(server: Server, retryCount: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const client = new Client()
      const entry: ConnectionEntry = {
        client,
        status: 'connecting',
        retryCount,
        retryTimer: null,
        server
      }
      this.connections.set(server.id, entry)
      this.emit('status', { serverId: server.id, status: 'connecting' })

      const config: ConnectConfig = {
        host: server.host,
        port: server.port,
        username: server.username,
        readyTimeout: 20000
      }
      if (server.authType === 'password' && server.password) {
        config.password = server.password
      } else if (server.authType === 'privateKey' && server.privateKey) {
        config.privateKey = server.privateKey
        if (server.passphrase) config.passphrase = server.passphrase
      }

      client.on('ready', () => {
        entry.status = 'connected'
        entry.retryCount = 0
        this.emit('status', { serverId: server.id, status: 'connected' })
        resolve()
      })

      client.on('error', (err) => {
        entry.status = 'error'
        this.emit('status', { serverId: server.id, status: 'error', error: err.message })
        if (retryCount < MAX_RETRIES) {
          const delay = BASE_RETRY_DELAY * Math.pow(2, retryCount)
          entry.retryTimer = setTimeout(() => {
            this.doConnect(server, retryCount + 1).catch(() => {})
          }, delay)
        }
        reject(err)
      })

      client.on('close', () => {
        if (entry.status === 'connected') {
          entry.status = 'disconnected'
          this.emit('status', { serverId: server.id, status: 'disconnected' })
          if (entry.retryCount < MAX_RETRIES) {
            const delay = BASE_RETRY_DELAY * Math.pow(2, entry.retryCount)
            entry.retryTimer = setTimeout(() => {
              this.doConnect(server, entry.retryCount + 1).catch(() => {})
            }, delay)
          }
        }
      })

      client.connect(config)
    })
  }

  disconnect(serverId: string): void {
    const entry = this.connections.get(serverId)
    if (!entry) return
    if (entry.retryTimer) clearTimeout(entry.retryTimer)
    entry.status = 'disconnected'
    entry.client.destroy()
    this.connections.delete(serverId)
    this.connectPromises.delete(serverId)
    this.emit('status', { serverId, status: 'disconnected' })
  }

  disconnectAll(): void {
    for (const id of this.connections.keys()) {
      this.disconnect(id)
    }
  }

  getStatus(serverId: string): string {
    return this.connections.get(serverId)?.status ?? 'disconnected'
  }

  async execCommand(serverId: string, command: string): Promise<ExecResult> {
    const entry = this.connections.get(serverId)
    if (!entry || entry.status !== 'connected') {
      throw new Error(`Server ${serverId} is not connected`)
    }
    return new Promise((resolve, reject) => {
      entry.client.exec(command, (err, stream) => {
        if (err) return reject(err)
        let stdout = ''
        let stderr = ''
        stream.on('data', (data: Buffer) => { stdout += data.toString() })
        stream.stderr.on('data', (data: Buffer) => { stderr += data.toString() })
        stream.on('close', (code: number) => {
          resolve({ stdout, stderr, code: code ?? 0 })
        })
        stream.on('error', reject)
      })
    })
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
    let stream: { close: () => void } | null = null
    entry.client.exec(command, (err, s) => {
      if (err) { onError(err); return }
      stream = s
      s.on('data', (data: Buffer) => onData(data.toString()))
      s.stderr.on('data', (data: Buffer) => onData(data.toString()))
      s.on('close', onClose)
      s.on('error', onError)
    })
    return () => { if (stream) stream.close() }
  }

  async testConnection(server: Server): Promise<{ success: boolean; error?: string; latency?: number }> {
    const start = Date.now()
    const client = new Client()
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        client.destroy()
        resolve({ success: false, error: 'Connection timed out' })
      }, 15000)

      const config: ConnectConfig = {
        host: server.host,
        port: server.port,
        username: server.username,
        readyTimeout: 10000
      }
      if (server.authType === 'password' && server.password) {
        config.password = server.password
      } else if (server.authType === 'privateKey' && server.privateKey) {
        config.privateKey = server.privateKey
        if (server.passphrase) config.passphrase = server.passphrase
      }

      client.on('ready', () => {
        clearTimeout(timer)
        const latency = Date.now() - start
        client.end()
        resolve({ success: true, latency })
      })

      client.on('error', (err) => {
        clearTimeout(timer)
        resolve({ success: false, error: err.message })
      })

      client.connect(config)
    })
  }
}

export const sshManager = new SSHManager()
