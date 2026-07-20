import React, { useEffect, useRef, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

const terminalBuffers = new Map<string, string>()
const MAX_TERMINAL_BUFFER = 200_000

interface SSHTerminalProps {
  sessionId: string | null
  className?: string
  minHeight?: number
  fontSize?: number
  onSessionClose?: () => void
  onSessionError?: (message: string) => void
}

export function SSHTerminal({
  sessionId,
  className = '',
  minHeight = 200,
  fontSize = 13,
  onSessionClose,
  onSessionError
}: SSHTerminalProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const sessionRef = useRef<string | null>(null)
  const unsubRef = useRef<(() => void) | null>(null)

  const syncSize = useCallback((sid: string) => {
    fitAddonRef.current?.fit()
    const term = terminalRef.current
    if (term) {
      window.monitcAPI.terminal.resize(sid, term.cols, term.rows)
    }
  }, [])

  const initTerminal = useCallback(() => {
    if (!containerRef.current || terminalRef.current) return

    const term = new Terminal({
      theme: {
        background: '#0a0a0f',
        foreground: '#e2e8f0',
        cursor: '#6366f1',
        black: '#1e1e2e',
        brightBlack: '#374151',
        red: '#ef4444',
        brightRed: '#f87171',
        green: '#22c55e',
        brightGreen: '#4ade80',
        yellow: '#f59e0b',
        brightYellow: '#fbbf24',
        blue: '#6366f1',
        brightBlue: '#818cf8',
        magenta: '#a855f7',
        brightMagenta: '#c084fc',
        cyan: '#06b6d4',
        brightCyan: '#22d3ee',
        white: '#e2e8f0',
        brightWhite: '#f8fafc'
      },
      fontSize,
      fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
      cursorBlink: true,
      scrollback: 10000,
      allowProposedApi: true
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)
    fitAddon.fit()

    term.onData((data) => {
      const sid = sessionRef.current
      if (sid) window.monitcAPI.terminal.write(sid, data)
    })

    terminalRef.current = term
    fitAddonRef.current = fitAddon
  }, [fontSize])

  useEffect(() => {
    initTerminal()
    const observer = new ResizeObserver(() => {
      const sid = sessionRef.current
      if (sid) syncSize(sid)
    })
    if (containerRef.current) observer.observe(containerRef.current)
    return () => {
      observer.disconnect()
      unsubRef.current?.()
      terminalRef.current?.dispose()
      terminalRef.current = null
    }
  }, [initTerminal, syncSize])

  useEffect(() => {
    unsubRef.current?.()
    sessionRef.current = sessionId
    const term = terminalRef.current
    if (!term) return

    if (!sessionId) {
      term.clear()
      term.writeln('\x1b[90mSelect a server and click Connect to open an SSH session.\x1b[0m')
      return
    }

    term.clear()
    const bufferedOutput = terminalBuffers.get(sessionId)
    if (bufferedOutput) term.write(bufferedOutput)
    term.focus()

    const onData = window.monitcAPI.terminal.onData(sessionId, (data) => {
      const nextBuffer = `${terminalBuffers.get(sessionId) ?? ''}${data}`
      terminalBuffers.set(sessionId, nextBuffer.slice(-MAX_TERMINAL_BUFFER))
      term.write(data)
    })
    const onClose = window.monitcAPI.terminal.onClose(sessionId, () => {
      term.writeln('\r\n\x1b[33m[Session closed]\x1b[0m')
      onSessionClose?.()
    })
    const onError = window.monitcAPI.terminal.onError(sessionId, (msg) => {
      term.writeln(`\r\n\x1b[31m[Error: ${msg}]\x1b[0m`)
      onSessionError?.(msg)
    })

    unsubRef.current = () => { onData(); onClose(); onError() }
    syncSize(sessionId)
  }, [onSessionClose, onSessionError, sessionId, syncSize])

  return (
    <div
      ref={containerRef}
      className={`h-full w-full ${className}`}
      style={{ minHeight }}
      onClick={() => terminalRef.current?.focus()}
    />
  )
}
