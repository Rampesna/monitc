import React, { useEffect, useRef, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'

interface LogTerminalProps {
  streamId: string | null
  onReady?: (terminal: Terminal) => void
  className?: string
}

export function LogTerminal({ streamId, onReady, className = '' }: LogTerminalProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const unsubRef = useRef<(() => void) | null>(null)

  const initTerminal = useCallback(() => {
    if (!containerRef.current) return
    if (terminalRef.current) { terminalRef.current.dispose(); terminalRef.current = null }

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
      fontSize: 13,
      fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
      cursorBlink: true,
      scrollback: 5000,
      convertEol: true
    })

    const fitAddon = new FitAddon()
    const searchAddon = new SearchAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(searchAddon)
    term.open(containerRef.current)
    fitAddon.fit()

    terminalRef.current = term
    fitAddonRef.current = fitAddon

    if (onReady) onReady(term)
  }, [onReady])

  useEffect(() => {
    initTerminal()
    const observer = new ResizeObserver(() => { fitAddonRef.current?.fit() })
    if (containerRef.current) observer.observe(containerRef.current)
    return () => {
      observer.disconnect()
      if (unsubRef.current) { unsubRef.current(); unsubRef.current = null }
      terminalRef.current?.dispose()
    }
  }, [initTerminal])

  useEffect(() => {
    if (unsubRef.current) { unsubRef.current(); unsubRef.current = null }
    if (!streamId || !terminalRef.current) return
    terminalRef.current.clear()
    const term = terminalRef.current
    const unsub = window.monitcAPI.logs.onData(streamId, (data) => {
      term.write(data)
    })
    const unsubClose = window.monitcAPI.logs.onClose(streamId, () => {
      term.writeln('\r\n\x1b[33m[Stream kapatıldı]\x1b[0m')
    })
    unsubRef.current = () => { unsub(); unsubClose() }
  }, [streamId])

  return <div ref={containerRef} className={`h-full w-full ${className}`} style={{ minHeight: 200 }} />
}
