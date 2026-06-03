import { EventEmitter } from 'events'
import crypto from 'crypto'
import os from 'os'
import * as pty from 'node-pty'

export class LocalTerminalManager extends EventEmitter {
  private sessions = new Map<string, pty.IPty>()

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  open(cols: number, rows: number): string {
    const sessionId = crypto.randomUUID()
    const shell = process.env.SHELL ?? (process.platform === 'win32' ? 'powershell.exe' : '/bin/bash')

    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: Math.max(cols, 80),
      rows: Math.max(rows, 24),
      cwd: os.homedir(),
      env: { ...process.env } as Record<string, string>
    })

    ptyProcess.onData((data) => {
      this.emit('data', { sessionId, data })
    })

    ptyProcess.onExit(() => {
      this.sessions.delete(sessionId)
      this.emit('close', { sessionId })
    })

    this.sessions.set(sessionId, ptyProcess)
    return sessionId
  }

  write(sessionId: string, data: string): void {
    this.sessions.get(sessionId)?.write(data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.sessions.get(sessionId)?.resize(Math.max(cols, 80), Math.max(rows, 24))
  }

  close(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    try {
      session.kill()
    } catch {
      /* already closed */
    }
    this.sessions.delete(sessionId)
  }

  stopAll(): void {
    for (const id of [...this.sessions.keys()]) this.close(id)
  }
}

export const localTerminalManager = new LocalTerminalManager()
