import { useEffect, useRef, useState } from 'react'
import { Maximize2, RefreshCw, TerminalSquare, Wifi, WifiOff } from 'lucide-react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { api, apiOrigin, jsonBody } from '../lib/api'

export function WebTerminal({ serverId }: { serverId: string }) {
  const target = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const [state, setState] = useState<'connecting' | 'connected' | 'closed' | 'error'>('connecting')
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    if (!target.current) return
    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontFamily: '"SFMono-Regular", "Cascadia Code", "Liberation Mono", monospace',
      fontSize: 13,
      lineHeight: 1.35,
      theme: {
        background: '#09090e',
        foreground: '#c9c7d4',
        cursor: '#8b7cff',
        selectionBackground: '#7668ef55',
        black: '#111119',
        red: '#ff6b81',
        green: '#58dba0',
        yellow: '#d8c777',
        blue: '#78a9ff',
        magenta: '#a990ff',
        cyan: '#48d5e5',
        white: '#f4f2fa'
      },
      scrollback: 10_000
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(target.current)
    terminalRef.current = terminal
    requestAnimationFrame(() => fit.fit())
    terminal.writeln('\x1b[38;2;139;124;255mmonitc secure terminal\x1b[0m')
    terminal.writeln('\x1b[90mCreating a one-time session…\x1b[0m\r\n')
    setState('connecting')

    let disposed = false
    let socket: WebSocket | null = null
    void api<{ ticket: string }>(`/api/v1/servers/${serverId}/access-ticket`, {
      method: 'POST',
      ...jsonBody({ capability: 'terminal' })
    }).then(({ ticket }) => {
      if (disposed) return
      const wsOrigin = apiOrigin().replace(/^http/, 'ws')
      socket = new WebSocket(`${wsOrigin}/api/v1/ws/terminal?ticket=${encodeURIComponent(ticket)}`)
      socketRef.current = socket
      socket.addEventListener('open', () => {
        setState('connected')
        terminal.writeln('\x1b[32mConnected.\x1b[0m\r\n')
        socket?.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }))
      })
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data)) as { type: string; data?: string }
        if (message.type === 'output' && message.data) terminal.write(message.data)
      })
      socket.addEventListener('close', (event) => {
        if (!disposed) {
          setState(event.code === 1000 ? 'closed' : 'error')
          terminal.writeln(`\r\n\x1b[90mSession closed${event.reason ? `: ${event.reason}` : '.'}\x1b[0m`)
        }
      })
      socket.addEventListener('error', () => setState('error'))
    }).catch((error) => {
      setState('error')
      terminal.writeln(`\x1b[31m${error instanceof Error ? error.message : 'Connection failed.'}\x1b[0m`)
    })

    const input = terminal.onData((data) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'input', data }))
    })
    const resize = terminal.onResize(({ cols, rows }) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'resize', cols, rows }))
    })
    const observer = new ResizeObserver(() => requestAnimationFrame(() => fit.fit()))
    observer.observe(target.current)

    return () => {
      disposed = true
      observer.disconnect()
      input.dispose()
      resize.dispose()
      socket?.close(1000, 'View closed')
      terminal.dispose()
      terminalRef.current = null
      socketRef.current = null
    }
  }, [serverId, generation])

  const statusIcon = state === 'connected' ? <Wifi size={13} /> : state === 'connecting' ? <RefreshCw size={13} className="spin" /> : <WifiOff size={13} />
  return (
    <section className="terminal-workspace">
      <header>
        <div><TerminalSquare size={15} /><strong>SSH terminal</strong><span className={`terminal-status ${state}`}>{statusIcon}{state}</span></div>
        <div>
          <button className="icon-button" title="Fit terminal" onClick={() => window.dispatchEvent(new Event('resize'))}><Maximize2 size={15} /></button>
          {state !== 'connected' && <button className="secondary-button compact" onClick={() => setGeneration((value) => value + 1)}><RefreshCw size={13} /> Reconnect</button>}
        </div>
      </header>
      <div className="terminal-mount" ref={target} />
      <footer><span>One-time WebSocket ticket</span><span>Encrypted transport · credentials never sent to this tab</span></footer>
    </section>
  )
}
