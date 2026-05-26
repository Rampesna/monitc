import React, { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Server, Cpu, HardDrive, Network, Clock, Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useApp } from '../context/AppContext'
import { Card } from '../components/common/Card'
import { MetricGauge } from '../components/common/MetricGauge'
import { StatusDot } from '../components/common/StatusDot'
import { AreaChart } from '../components/charts/AreaChart'
import { Badge } from '../components/common/Badge'
import { Button } from '../components/common/Button'
import { ExportReportModal } from '../components/export/ExportReportModal'
import { formatBytes, formatUptime } from '../lib/format'
import type { SystemMetrics, ConnectionState } from '../lib/types'

function MetricCard({ icon, label, value, unit, sub, color = 'text-indigo-400' }: { icon: React.ReactNode; label: string; value: string; unit: string; sub?: string; color?: string }): React.ReactElement {
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-slate-400">
        <span className={color}>{icon}</span>
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div>
        <span className="text-2xl font-bold text-slate-100">{value}</span>
        <span className="text-sm text-slate-400 ml-1">{unit}</span>
      </div>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
    </Card>
  )
}

export function ServerDashboard(): React.ReactElement {
  const { t } = useTranslation()
  const { serverId } = useParams<{ serverId: string }>()
  const { state } = useApp()
  const [showExport, setShowExport] = useState(false)

  const server = state.servers.find((s) => s.id === serverId)
  const history = state.metricsHistory[serverId ?? ''] ?? []
  const latest: SystemMetrics | undefined = history[history.length - 1]
  const connStatus = (state.connectionStatuses[serverId ?? ''] ?? 'disconnected') as ConnectionState

  const chartData = useMemo(() => history.map((m) => ({
    timestamp: new Date(m.timestamp).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    cpu: Math.round(m.cpu.percent),
    ram: m.memory.percent
  })), [history])

  if (!server) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-slate-500">{t('common.noData')}</p>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-600/20 flex items-center justify-center">
            <Server size={16} className="text-indigo-400" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-slate-100">{server.name}</h1>
            <p className="text-xs text-slate-500">{server.host}:{server.port} · {server.username}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {latest && (
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <Clock size={12} />
              {t('serverDashboard.uptime')}: {formatUptime(latest.uptime)}
            </div>
          )}
          <StatusDot status={connStatus} showLabel />
          <Button variant="ghost" size="sm" icon={<Download size={13} />} onClick={() => setShowExport(true)}>
            {t('export.button')}
          </Button>
        </div>
      </div>

      {showExport && server && (
        <ExportReportModal server={server} onClose={() => setShowExport(false)} />
      )}

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <Card className="flex flex-col items-center gap-3 py-5">
          <MetricGauge value={latest?.cpu.percent ?? 0} label={t('serverDashboard.cpuUsage')} size="lg" />
          <div className="text-xs text-slate-500">Load: {latest?.cpu.loadAvg.map((l) => l.toFixed(2)).join(' / ') ?? '-'}</div>
        </Card>
        <Card className="flex flex-col items-center gap-3 py-5">
          <MetricGauge value={latest?.memory.percent ?? 0} label={t('serverDashboard.ramUsage')} size="lg" />
          <div className="text-xs text-slate-500">{latest ? `${formatBytes(latest.memory.used)} / ${formatBytes(latest.memory.total)}` : '-'}</div>
        </Card>
        <Card className="flex flex-col items-center gap-3 py-5">
          <MetricGauge
            value={latest?.disk.find((d) => d.mountpoint === '/')?.percent ?? 0}
            label={`${t('serverDashboard.diskUsage')} (/)`}
            size="lg"
          />
          <div className="text-xs text-slate-500">
            {latest?.disk.find((d) => d.mountpoint === '/') ? `${formatBytes(latest.disk.find((d) => d.mountpoint === '/')!.used)} / ${formatBytes(latest.disk.find((d) => d.mountpoint === '/')!.total)}` : '-'}
          </div>
        </Card>
        <Card className="flex flex-col gap-2 py-5 px-4">
          <div className="flex items-center gap-1.5 text-slate-400 mb-1">
            <Network size={14} />
            <span className="text-xs font-medium">{t('serverDashboard.networkIO')}</span>
          </div>
          {latest?.network.slice(0, 3).map((n) => (
            <div key={n.name} className="flex items-center justify-between text-xs">
              <span className="text-slate-500">{n.name}</span>
              <span className="text-slate-300">↓{formatBytes(n.rxBytes)}/s ↑{formatBytes(n.txBytes)}/s</span>
            </div>
          )) ?? <span className="text-xs text-slate-600">{t('common.noData')}</span>}
        </Card>
      </div>

      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <Cpu size={14} className="text-indigo-400" />
            {t('serverDashboard.cpuUsage')} &amp; {t('serverDashboard.ramUsage')}
          </h2>
          <span className="text-xs text-slate-500">{history.length}</span>
        </div>
        <AreaChart
          data={chartData}
          series={[
            { key: 'cpu', label: 'CPU %', color: '#6366f1' },
            { key: 'ram', label: 'RAM %', color: '#22c55e' }
          ]}
          xKey="timestamp"
          yDomain={[0, 100]}
          yFormatter={(v) => `${v}%`}
          height={220}
        />
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card>
          <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2 mb-3">
            <HardDrive size={14} className="text-amber-400" />
            {t('serverDashboard.diskUsage')}
          </h2>
          <div className="space-y-2">
            {(latest?.disk ?? []).map((d) => (
              <div key={d.mountpoint} className="flex items-center gap-3 text-xs">
                <span className="text-slate-500 w-16 truncate">{d.mountpoint}</span>
                <div className="flex-1 bg-[#1e1e2e] rounded-full h-1.5 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${d.percent}%`, backgroundColor: d.percent > 90 ? '#ef4444' : d.percent > 70 ? '#f59e0b' : '#6366f1' }}
                  />
                </div>
                <span className={`w-8 text-right ${d.percent > 90 ? 'text-red-400' : d.percent > 70 ? 'text-amber-400' : 'text-slate-300'}`}>{d.percent}%</span>
                <span className="text-slate-500">{formatBytes(d.available)}</span>
              </div>
            ))}
            {!latest?.disk.length && <p className="text-xs text-slate-600">{t('common.noData')}</p>}
          </div>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2 mb-3">
            <Network size={14} className="text-blue-400" />
            {t('serverDashboard.networkIO')}
          </h2>
          <div className="space-y-2">
            {(latest?.network ?? []).map((n) => (
              <div key={n.name} className="flex items-center justify-between text-xs py-1 border-b border-[#1e1e2e] last:border-0">
                <Badge variant="default">{n.name}</Badge>
                <div className="flex gap-3 text-slate-400">
                  <span className="text-green-400">↓ {formatBytes(n.rxBytes)}/s</span>
                  <span className="text-blue-400">↑ {formatBytes(n.txBytes)}/s</span>
                </div>
              </div>
            ))}
            {!latest?.network.length && <p className="text-xs text-slate-600">{t('common.noData')}</p>}
          </div>
        </Card>
      </div>
    </div>
  )
}
