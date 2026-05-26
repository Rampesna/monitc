/**
 * ReportCanvas — off-screen, light-theme report layout.
 * Rendered into a hidden div, then captured by html2canvas.
 *
 * Rules:
 *  - Fixed pixel dimensions (no ResponsiveContainer) so SVG is captured correctly.
 *  - White / very-light palette so the export looks professional on paper / screen.
 */
import React, { useMemo } from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  BarChart,
  Bar
} from 'recharts'
import { formatBytes } from '../../lib/format'
import type { Server } from '../../lib/types'

const REPORT_WIDTH = 900

// Colour palette (light background)
const C = {
  bg:       '#ffffff',
  surface:  '#f8fafc',
  border:   '#e2e8f0',
  text:     '#0f172a',
  muted:    '#64748b',
  cpu:      '#6366f1',
  ram:      '#22c55e',
  disk:     '#f59e0b',
  netRx:    '#38bdf8',
  netTx:    '#818cf8',
  accent:   '#6366f1'
}

interface Props {
  server: Server
  history: MetricsHistoryPoint[]
  hours: number
}

function sectionTitle(text: string): React.ReactElement {
  return (
    <div style={{ borderBottom: `2px solid ${C.border}`, paddingBottom: 6, marginBottom: 16 }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: C.text, letterSpacing: 0.3, textTransform: 'uppercase' }}>
        {text}
      </span>
    </div>
  )
}

export const ReportCanvas = React.forwardRef<HTMLDivElement, Props>(
  ({ server, history, hours }, ref) => {
    const latest = history[history.length - 1]

    // ── Chart data ─────────────────────────────────────────────────────────
    const timeLabel = (ts: number): string =>
      new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

    // Downsample to at most 120 points so the chart stays readable
    const sample = useMemo(() => {
      if (history.length <= 120) return history
      const step = Math.ceil(history.length / 120)
      return history.filter((_, i) => i % step === 0)
    }, [history])

    const cpuRamData = sample.map((m) => ({
      t:   timeLabel(m.timestamp),
      cpu: Math.round(m.cpu.percent),
      ram: m.memory.percent
    }))

    const netData = sample.map((m) => {
      const total = m.network.reduce((s, n) => ({ rx: s.rx + n.rxBytes, tx: s.tx + n.txBytes }), { rx: 0, tx: 0 })
      return { t: timeLabel(m.timestamp), rx: Math.round(total.rx / 1024), tx: Math.round(total.tx / 1024) }
    })

    const diskPartitions = (latest?.disk ?? []).slice(0, 8)

    // ── Summary stats ──────────────────────────────────────────────────────
    const avgCpu = history.length ? Math.round(history.reduce((s, m) => s + m.cpu.percent, 0) / history.length) : 0
    const maxCpu = history.length ? Math.round(Math.max(...history.map((m) => m.cpu.percent))) : 0
    const avgRam = history.length ? Math.round(history.reduce((s, m) => s + m.memory.percent, 0) / history.length) : 0
    const maxRam = history.length ? Math.max(...history.map((m) => m.memory.percent)) : 0

    const periodLabel = hours === 1 ? 'Last 1 hour' : hours === 6 ? 'Last 6 hours' : hours === 24 ? 'Last 24 hours' : `Last ${hours} hours`
    const generatedAt = new Date().toLocaleString()

    const chartProps = {
      width:  REPORT_WIDTH - 48,
      margin: { top: 8, right: 16, bottom: 4, left: 0 }
    }

    return (
      <div
        ref={ref}
        style={{
          width: REPORT_WIDTH,
          backgroundColor: C.bg,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          color: C.text,
          padding: 40
        }}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 36 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: C.accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ color: '#fff', fontSize: 16, fontWeight: 800 }}>M</span>
              </div>
              <span style={{ fontSize: 22, fontWeight: 800, color: C.text }}>monitc</span>
            </div>
            <p style={{ fontSize: 11, color: C.muted, margin: 0 }}>Server Performance Report</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ fontSize: 16, fontWeight: 700, margin: '0 0 2px' }}>{server.name}</p>
            <p style={{ fontSize: 11, color: C.muted, margin: '0 0 2px' }}>{server.host}:{server.port} · {server.username}</p>
            <p style={{ fontSize: 11, color: C.muted, margin: 0 }}>{periodLabel} · Generated {generatedAt}</p>
          </div>
        </div>

        {/* ── Summary cards ──────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 32 }}>
          {[
            { label: 'Avg CPU',  value: `${avgCpu}%`,  sub: `Peak ${maxCpu}%`,  color: C.cpu  },
            { label: 'Avg RAM',  value: `${avgRam}%`,  sub: `Peak ${maxRam}%`,  color: C.ram  },
            { label: 'Disk (/)', value: `${latest?.disk.find((d) => d.mountpoint === '/')?.percent ?? 0}%`, sub: latest?.disk.find((d) => d.mountpoint === '/') ? formatBytes(latest.disk.find((d) => d.mountpoint === '/')!.available) + ' free' : '-', color: C.disk },
            { label: 'Samples',  value: String(history.length), sub: periodLabel, color: C.netRx }
          ].map((c) => (
            <div key={c.label} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px' }}>
              <p style={{ fontSize: 11, color: C.muted, margin: '0 0 6px', fontWeight: 600 }}>{c.label}</p>
              <p style={{ fontSize: 22, fontWeight: 800, color: c.color, margin: '0 0 4px' }}>{c.value}</p>
              <p style={{ fontSize: 11, color: C.muted, margin: 0 }}>{c.sub}</p>
            </div>
          ))}
        </div>

        {/* ── CPU & RAM chart ─────────────────────────────────────────────── */}
        <div style={{ marginBottom: 32 }}>
          {sectionTitle('CPU & RAM Usage')}
          <AreaChart {...chartProps} height={200} data={cpuRamData}>
            <defs>
              <linearGradient id="rc-cpu" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={C.cpu} stopOpacity={0.25} />
                <stop offset="95%" stopColor={C.cpu} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="rc-ram" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={C.ram} stopOpacity={0.25} />
                <stop offset="95%" stopColor={C.ram} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
            <XAxis dataKey="t" tick={{ fill: C.muted, fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fill: C.muted, fontSize: 10 }} tickLine={false} axisLine={false} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
            <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v: unknown) => [`${v}%`, '']} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Area type="monotone" dataKey="cpu" name="CPU %" stroke={C.cpu} strokeWidth={2} fill="url(#rc-cpu)" dot={false} />
            <Area type="monotone" dataKey="ram" name="RAM %" stroke={C.ram} strokeWidth={2} fill="url(#rc-ram)" dot={false} />
          </AreaChart>
        </div>

        {/* ── Network I/O chart ───────────────────────────────────────────── */}
        <div style={{ marginBottom: 32 }}>
          {sectionTitle('Network I/O (KB/s)')}
          <AreaChart {...chartProps} height={160} data={netData}>
            <defs>
              <linearGradient id="rc-rx" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={C.netRx} stopOpacity={0.25} />
                <stop offset="95%" stopColor={C.netRx} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="rc-tx" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={C.netTx} stopOpacity={0.25} />
                <stop offset="95%" stopColor={C.netTx} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
            <XAxis dataKey="t" tick={{ fill: C.muted, fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fill: C.muted, fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}KB`} />
            <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v: unknown) => [`${v} KB/s`, '']} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Area type="monotone" dataKey="rx" name="↓ RX" stroke={C.netRx} strokeWidth={2} fill="url(#rc-rx)" dot={false} />
            <Area type="monotone" dataKey="tx" name="↑ TX" stroke={C.netTx} strokeWidth={2} fill="url(#rc-tx)" dot={false} />
          </AreaChart>
        </div>

        {/* ── Disk usage bars ─────────────────────────────────────────────── */}
        {diskPartitions.length > 0 && (
          <div style={{ marginBottom: 32 }}>
            {sectionTitle('Disk Partitions')}
            <BarChart
              {...chartProps}
              height={Math.max(120, diskPartitions.length * 36)}
              data={diskPartitions.map((d) => ({ name: d.mountpoint, used: d.percent, free: 100 - d.percent }))}
              layout="vertical"
            >
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} horizontal={false} />
              <XAxis type="number" domain={[0, 100]} tick={{ fill: C.muted, fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
              <YAxis type="category" dataKey="name" tick={{ fill: C.muted, fontSize: 10 }} tickLine={false} axisLine={false} width={70} />
              <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v: unknown) => [`${v}%`, '']} />
              <Bar dataKey="used" name="Used" stackId="a" fill={C.disk} radius={0} />
              <Bar dataKey="free" name="Free" stackId="a" fill={C.border} radius={[0, 4, 4, 0]} />
            </BarChart>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginTop: 12 }}>
              {diskPartitions.map((d) => (
                <div key={d.mountpoint} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px' }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: C.text, margin: '0 0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.mountpoint}</p>
                  <p style={{ fontSize: 10, color: C.muted, margin: 0 }}>Used: {formatBytes(d.used)} · Free: {formatBytes(d.available)}</p>
                  <div style={{ marginTop: 6, height: 4, background: C.border, borderRadius: 2 }}>
                    <div style={{ height: '100%', width: `${d.percent}%`, background: d.percent > 90 ? '#ef4444' : d.percent > 70 ? C.disk : C.cpu, borderRadius: 2 }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Network interface table ──────────────────────────────────────── */}
        {(latest?.network.length ?? 0) > 0 && (
          <div style={{ marginBottom: 32 }}>
            {sectionTitle('Network Interfaces (last sample)')}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: C.surface }}>
                  {['Interface', '↓ RX', '↑ TX', 'RX Packets', 'TX Packets'].map((h) => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: C.muted, fontWeight: 600, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(latest?.network ?? []).map((n, i) => (
                  <tr key={n.name} style={{ background: i % 2 === 0 ? C.bg : C.surface }}>
                    <td style={{ padding: '7px 12px', color: C.text, fontWeight: 600 }}>{n.name}</td>
                    <td style={{ padding: '7px 12px', color: C.netRx }}>{formatBytes(n.rxBytes)}/s</td>
                    <td style={{ padding: '7px 12px', color: C.netTx }}>{formatBytes(n.txBytes)}/s</td>
                    <td style={{ padding: '7px 12px', color: C.muted }}>{n.rxPackets.toLocaleString()}</td>
                    <td style={{ padding: '7px 12px', color: C.muted }}>{n.txPackets.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: C.muted }}>Generated by monitc · {generatedAt}</span>
          <span style={{ fontSize: 10, color: C.muted }}>{server.host} · {periodLabel} · {history.length} data points</span>
        </div>
      </div>
    )
  }
)

ReportCanvas.displayName = 'ReportCanvas'
