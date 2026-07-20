import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Box,
  Clock3,
  Download,
  FolderOpen,
  HardDrive,
  Network,
  Plus,
  Server,
  TerminalSquare
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useApp } from '../context/AppContext'
import { Card } from '../components/common/Card'
import { MetricGauge } from '../components/common/MetricGauge'
import { AreaChart } from '../components/charts/AreaChart'
import { Badge } from '../components/common/Badge'
import { Button } from '../components/common/Button'
import { ExportReportModal } from '../components/export/ExportReportModal'
import { formatBytes, formatUptime } from '../lib/format'
import type { SystemMetrics, ConnectionState } from '../lib/types'

export function Dashboard({ serverIdOverride }: { serverIdOverride?: string } = {}): React.ReactElement {
  const { t } = useTranslation()
  const { state } = useApp()
  const navigate = useNavigate()
  const [showExport, setShowExport] = useState(false)

  const serverId = serverIdOverride ?? state.selectedServerId ?? ''
  const server = state.servers.find((item) => item.id === serverId)
  const history = state.metricsHistory[serverId] ?? []
  const latest: SystemMetrics | undefined = history[history.length - 1]
  const connStatus = (state.connectionStatuses[serverId] ?? 'disconnected') as ConnectionState
  const docker = state.dockerData[serverId]
  const rootDisk = latest?.disk.find((disk) => disk.mountpoint === '/') ?? latest?.disk[0]
  const containers = docker?.containers ?? []
  const runningContainers = containers.filter((container) => container.state.toLowerCase() === 'running')

  const chartData = useMemo(() => history.slice(-30).map((metrics) => ({
    timestamp: new Date(metrics.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
    cpu: Math.round(metrics.cpu.percent),
    ram: Math.round(metrics.memory.percent)
  })), [history])

  if (!server) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-5 p-8">
        <div className="empty-state-icon"><Server size={26} /></div>
        <div className="text-center">
          <p className="section-eyebrow mb-2">INFRASTRUCTURE</p>
          <h2 className="text-xl font-semibold text-slate-100 mb-1">{t('dashboard.noServers')}</h2>
          <p className="text-slate-500 text-sm">{t('dashboard.addServer')}</p>
        </div>
        <Button variant="primary" icon={<Plus size={14} />} onClick={() => navigate('/servers')}>
          {t('serversTab.addServer')}
        </Button>
      </div>
    )
  }

  return (
    <div className="dashboard-page p-6">
      <div className="dashboard-hero">
        <div>
          <p className="section-eyebrow">INFRASTRUCTURE</p>
          <h1>{server.name}<span className="text-slate-600"> · {t(`connection.${connStatus}`)}</span></h1>
          <p>{server.username}@{server.host}:{server.port}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className={`live-pill ${connStatus === 'connected' ? 'is-live' : ''}`}>
            <Activity size={13} />
            <span>{t(`connection.${connStatus}`)}</span>
          </div>
          <Button variant="ghost" size="sm" icon={<Download size={13} />} onClick={() => setShowExport(true)}>
            {t('export.button')}
          </Button>
        </div>
      </div>

      {showExport && <ExportReportModal server={server} onClose={() => setShowExport(false)} />}

      <div className="dashboard-grid">
        <Card className="dashboard-panel core-panel !p-0">
          <div className="panel-heading">
            <span>Production core</span>
            <span className={`panel-state ${connStatus === 'connected' ? 'connected' : ''}`}>
              <i /> {t(`connection.${connStatus}`)}
            </span>
          </div>
          <div className="core-gauges">
            <MetricGauge value={latest?.cpu.percent ?? 0} label={t('dashboard.cpu')} tone="purple" size="lg" />
            <MetricGauge value={latest?.memory.percent ?? 0} label={t('dashboard.ram')} tone="cyan" size="lg" />
            <MetricGauge value={rootDisk?.percent ?? 0} label={t('dashboard.disk')} tone="green" size="lg" />
          </div>
          <div className="core-footer">
            <span><Clock3 size={13} /> {latest ? formatUptime(latest.uptime) : t('serverDashboard.noMetrics')}</span>
            <span><Network size={13} /> {server.host}</span>
          </div>
        </Card>

        <Card className="dashboard-panel activity-panel !p-0">
          <div className="panel-heading">
            <span>Resource activity</span>
            <span className="panel-meta">Last 30 samples</span>
          </div>
          {chartData.length > 1 ? (
            <AreaChart
              data={chartData}
              series={[
                { key: 'cpu', label: 'CPU', color: '#42d5e8' },
                { key: 'ram', label: 'Memory', color: '#806bff' }
              ]}
              xKey="timestamp"
              yDomain={[0, 100]}
              yFormatter={(value) => `${value}%`}
              height={230}
              className="activity-chart"
            />
          ) : (
            <div className="chart-empty">
              <Activity size={21} />
              <span>{t('serverDashboard.noMetrics')}</span>
            </div>
          )}
        </Card>

        <Card className="dashboard-panel containers-panel !p-0">
          <div className="panel-heading">
            <span>{t('docker.containers')}</span>
            <button type="button" onClick={() => navigate('/docker')}>
              {runningContainers.length} running
            </button>
          </div>
          <div className="container-list">
            {containers.slice(0, 3).map((container) => {
              const running = container.state.toLowerCase() === 'running'
              return (
                <button key={container.id} type="button" className="container-row" onClick={() => navigate(`/docker/${serverId}/${container.id}`)}>
                  <span className="container-icon"><Box size={15} /></span>
                  <span className="container-copy">
                    <b>{container.names.replace(/^\//, '')}</b>
                    <small>{container.image} · {container.status}</small>
                  </span>
                  <i className={running ? 'running' : ''} />
                </button>
              )
            })}
            {!containers.length && (
              <div className="panel-empty">
                <Box size={20} />
                <span>{docker?.available === false ? 'Docker is unavailable' : t('docker.noContainers')}</span>
              </div>
            )}
          </div>
        </Card>

        <Card className="dashboard-panel terminal-panel !p-0">
          <div className="panel-heading">
            <span>Quick terminal</span>
            <span className="panel-meta">{server.username}@{server.name.toLowerCase().replace(/\s+/g, '-')}</span>
          </div>
          <button type="button" className="terminal-preview" onClick={() => navigate('/terminal')}>
            <code><em>~</em> monitc status</code>
            <code><strong>✓</strong> {state.servers.filter((item) => state.connectionStatuses[item.id] === 'connected').length} servers connected</code>
            <code><strong>✓</strong> {runningContainers.length} containers running</code>
            <code><em>~</em> <span className="terminal-caret" /></code>
            <span className="terminal-open"><TerminalSquare size={13} /> Open terminal</span>
          </button>
        </Card>
      </div>

      <div className="dashboard-details">
        <Card>
          <div className="detail-heading">
            <span><HardDrive size={14} /> {t('serverDashboard.diskUsage')}</span>
            <span>{latest?.disk.length ?? 0} volumes</span>
          </div>
          <div className="space-y-3">
            {(latest?.disk ?? []).map((disk) => (
              <div key={disk.mountpoint} className="disk-row">
                <div><b>{disk.mountpoint}</b><small>{disk.source}</small></div>
                <div className="disk-track"><i style={{ width: `${disk.percent}%` }} /></div>
                <span>{disk.percent}%</span>
                <small>{formatBytes(disk.available)} free</small>
              </div>
            ))}
            {!latest?.disk.length && <div className="panel-empty compact">{t('common.noData')}</div>}
          </div>
        </Card>

        <Card>
          <div className="detail-heading">
            <span><Network size={14} /> {t('serverDashboard.networkIO')}</span>
            <span>{latest?.network.length ?? 0} interfaces</span>
          </div>
          <div className="network-list">
            {(latest?.network ?? []).map((network) => (
              <div key={network.name} className="network-row">
                <Badge variant="default">{network.name}</Badge>
                <span><ArrowDown size={12} /> {formatBytes(network.rxBytes)}/s</span>
                <span><ArrowUp size={12} /> {formatBytes(network.txBytes)}/s</span>
              </div>
            ))}
            {!latest?.network.length && <div className="panel-empty compact">{t('common.noData')}</div>}
          </div>
        </Card>
      </div>

      <button type="button" className="floating-files" onClick={() => navigate(`/sftp?server=${serverId}`)} title={t('sftp.openFiles')}>
        <FolderOpen size={16} />
      </button>
    </div>
  )
}
