import { Client, ConnectConfig } from 'ssh2'
import { EventEmitter } from 'events'
import crypto from 'crypto'
import type { Server } from '../store/types'

interface ShellStream {
  write: (data: string | Buffer) => void
  close: () => void
  setWindow?: (rows: number, cols: number, height: number, width: number) => void
  on: (event: string, cb: (...args: unknown[]) => void) => void
}

interface TerminalSession {
  id: string
  serverId: string
  client: Client
  stream: ShellStream
}

function buildConfig(server: Server): ConnectConfig {
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
  return config
}

export class SSHTerminalManager extends EventEmitter {
  private sessions = new Map<string, TerminalSession>()

  open(server: Server, cols: number, rows: number): Promise<string> {
    const sessionId = crypto.randomUUID()

    return new Promise((resolve, reject) => {
      const client = new Client()
      const config = buildConfig(server)

      const fail = (err: Error): void => {
        client.destroy()
        reject(err)
      }

      client.on('ready', () => {
        client.shell(
          { term: 'xterm-256color', cols: Math.max(cols, 80), rows: Math.max(rows, 24) },
          (err, stream) => {
            if (err) return fail(err)

            stream.on('data', (data: Buffer) => {
              this.emit('data', { sessionId, data: data.toString('utf-8') })
            })

            const stderr = (stream as { stderr?: { on: (e: string, cb: (d: Buffer) => void) => void } }).stderr
            stderr?.on('data', (data: Buffer) => {
              this.emit('data', { sessionId, data: data.toString('utf-8') })
            })

            stream.on('close', () => {
              this.sessions.delete(sessionId)
              client.end()
              this.emit('close', { sessionId })
            })

            this.sessions.set(sessionId, {
              id: sessionId,
              serverId: server.id,
              client,
              stream: stream as unknown as ShellStream
            })
            resolve(sessionId)
          }
        )
      })

      client.on('error', fail)
      client.connect(config)
    })
  }

  write(sessionId: string, data: string): void {
    this.sessions.get(sessionId)?.stream.write(data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const stream = this.sessions.get(sessionId)?.stream
    if (stream?.setWindow) {
      stream.setWindow(rows, cols, 0, 0)
    }
  }

  close(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    try { session.stream.close() } catch { /* already closed */ }
    try { session.client.end() } catch { /* already closed */ }
    this.sessions.delete(sessionId)
  }

  closeAllForServer(serverId: string): void {
    for (const session of this.sessions.values()) {
      if (session.serverId === serverId) this.close(session.id)
    }
  }

  stopAll(): void {
    for (const id of [...this.sessions.keys()]) this.close(id)
  }
}

export const sshTerminalManager = new SSHTerminalManager()
