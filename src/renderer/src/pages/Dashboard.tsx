import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Box,
  Clock3,
  Download,
  FolderOpen,
  HardDrive,
  ListFilter,
  Maximize2,
  Network,
  PlugZap,
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
import { GaugeSkeleton, RowSkeleton, Skeleton } from '../components/common/Skeleton'
import { SSHTerminal } from '../components/terminal/SSHTerminal'

export function Dashboard({ serverIdOverride }: { serverIdOverride?: string } = {}): React.ReactElement {
  const { t } = useTranslation()
  const { state } = useApp()
  const navigate = useNavigate()
  const [showExport, setShowExport] = useState(false)
  const [showAllDisks, setShowAllDisks] = useState(false)
  const [showAllNetworks, setShowAllNetworks] = useState(false)
  const [quickSessionId, setQuickSessionId] = useState<string | null>(null)
  const [quickConnecting, setQuickConnecting] = useState(false)
  const [quickError, setQuickError] = useState('')
  const quickSessionRef = useRef<string | null>(null)
  const handoffRef = useRef(false)

  const serverId = serverIdOverride ?? state.selectedServerId ?? ''
  const server = state.servers.find((item) => item.id === serverId)
  const history = state.metricsHistory[serverId] ?? []
  const latest: SystemMetrics | undefined = history[history.length - 1]
  const connStatus = (state.connectionStatuses[serverId] ?? 'disconnected') as ConnectionState
  const docker = state.dockerData[serverId]
  const rootDisk = latest?.disk.find((disk) => disk.mountpoint === '/') ?? latest?.disk[0]
  const containers = docker?.containers ?? []
  const runningContainers = containers.filter((container) => container.state.toLowerCase() === 'running')
  const metricsLoading = !latest && ['connecting', 'reconnecting', 'connected'].includes(connStatus)
  const dockerLoading = !docker && ['connecting', 'reconnecting', 'connected'].includes(connStatus)

  const diskPartitions = latest?.disk ?? []
  const primaryDisks = useMemo(() => {
    const pseudoSource = /^(tmpfs|devtmpfs|overlay|shm|proc|sysfs|cgroup2?|pstore|securityfs|debugfs|tracefs|fusectl|configfs|mqueue|hugetlbfs|sunrpc|nsfs)$/i
    const systemMount = /^\/(run(?:\/|$)|sys(?:\/|$)|proc(?:\/|$)|dev\/shm(?:\/|$)|var\/lib\/(?:docker|containerd|kubelet)(?:\/|$))/i
    const meaningful = diskPartitions.filter((disk) => (
      disk.mountpoint === '/' || (!pseudoSource.test(disk.source) && !systemMount.test(disk.mountpoint))
    ))
    const result = meaningful.length ? meaningful : diskPartitions.slice(0, 1)
    return [...result].sort((left, right) => {
      if (left.mountpoint === '/') return -1
      if (right.mountpoint === '/') return 1
      return left.mountpoint.length - right.mountpoint.length || left.mountpoint.localeCompare(right.mountpoint)
    })
  }, [diskPartitions])
  const visibleDisks = showAllDisks ? diskPartitions : primaryDisks
  const hiddenDiskCount = Math.max(0, diskPartitions.length - primaryDisks.length)
  const networkInterfaces = latest?.network ?? []
  const primaryNetworks = useMemo(() => {
    const virtualInterface = /^(lo|docker\d*|br-|veth|virbr|cni|flannel|kube|tunl|vxlan|dummy|sit|ip6tnl)/i
    const meaningful = networkInterfaces.filter((network) => !virtualInterface.test(network.name))
    return meaningful.length ? meaningful : networkInterfaces.slice(0, 4)
  }, [networkInterfaces])
  const visibleNetworks = showAllNetworks ? networkInterfaces : primaryNetworks
  const hiddenNetworkCount = Math.max(0, networkInterfaces.length - primaryNetworks.length)

  const chartData = useMemo(() => history.slice(-30).map((metrics) => ({
    timestamp: new Date(metrics.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
    cpu: Math.round(metrics.cpu.percent),
    ram: Math.round(metrics.memory.percent)
  })), [history])

  const closeQuickSession = useCallback(async (): Promise<void> => {
    const sessionId = quickSessionRef.current
    quickSessionRef.current = null
    setQuickSessionId(null)
    if (sessionId) await window.monitcAPI.terminal.close(sessionId).catch(() => {})
  }, [])

  const connectQuickTerminal = useCallback(async (): Promise<void> => {
    if (!server || quickConnecting || quickSessionRef.current) return
    setQuickConnecting(true)
    setQuickError('')
    try {
      const result = await window.monitcAPI.terminal.open(server.id, 100, 24)
      if (!result.success || !result.sessionId) {
        setQuickError(result.error || 'Could not open the SSH session.')
        return
      }
      quickSessionRef.current = result.sessionId
      setQuickSessionId(result.sessionId)
    } catch (error) {
      setQuickError(error instanceof Error ? error.message : String(error))
    } finally {
      setQuickConnecting(false)
    }
  }, [quickConnecting, server])

  const handleQuickClose = useCallback((): void => {
    quickSessionRef.current = null
    setQuickSessionId(null)
    setQuickError('Session closed. Connect again whenever you need it.')
  }, [])

  const handleQuickError = useCallback((message: string): void => {
    setQuickError(message)
  }, [])

  const moveQuickTerminal = (): void => {
    if (!quickSessionId || !server) return
    handoffRef.current = true
    navigate('/terminal', {
      state: {
        attachedSession: {
          sessionId: quickSessionId,
          serverId: server.id,
          label: server.name,
          kind: 'ssh'
        }
      }
    })
  }

  useEffect(() => {
    handoffRef.current = false
    void closeQuickSession()
  }, [closeQuickSession, serverId])

  useEffect(() => () => {
    if (quickSessionRef.current && !handoffRef.current) {
      void window.monitcAPI.terminal.close(quickSessionRef.current).catch(() => {})
      quickSessionRef.current = null
    }
  }, [])

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
            {metricsLoading ? <><GaugeSkeleton /><GaugeSkeleton /><GaugeSkeleton /></> : <>
              <MetricGauge value={latest?.cpu.percent ?? 0} label={t('dashboard.cpu')} tone="purple" size="lg" />
              <MetricGauge value={latest?.memory.percent ?? 0} label={t('dashboard.ram')} tone="cyan" size="lg" />
              <MetricGauge value={rootDisk?.percent ?? 0} label={t('dashboard.disk')} tone="green" size="lg" />
            </>}
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
          ) : metricsLoading ? (
            <div className="chart-skeleton" aria-hidden="true">
              <Skeleton className="chart-skeleton-line line-one" />
              <Skeleton className="chart-skeleton-line line-two" />
              <div className="chart-skeleton-legend"><Skeleton className="w-20 h-2" /><Skeleton className="w-24 h-2" /></div>
            </div>
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
            {dockerLoading ? <><RowSkeleton /><RowSkeleton /><RowSkeleton /></> : containers.slice(0, 3).map((container) => {
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
            {!dockerLoading && !containers.length && (
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
            <div className="quick-terminal-tools">
              <span className="panel-meta">{server.username}@{server.name.toLowerCase().replace(/\s+/g, '-')}</span>
              {quickSessionId && (
                <button type="button" onClick={moveQuickTerminal} title="Move this session to the full terminal">
                  <Maximize2 size={13} />
                </button>
              )}
            </div>
          </div>
          <div className="quick-terminal-stage">
            {quickSessionId ? (
              <SSHTerminal
                sessionId={quickSessionId}
                minHeight={0}
                fontSize={11}
                className="quick-terminal-xterm"
                onSessionClose={handleQuickClose}
                onSessionError={handleQuickError}
              />
            ) : (
              <button type="button" className="quick-terminal-connect" onClick={connectQuickTerminal} disabled={quickConnecting}>
                <span className="quick-terminal-connect-icon"><PlugZap size={17} /></span>
                <span>
                  <b>{quickConnecting ? t('common.connecting') : 'Connect quick terminal'}</b>
                  <small>Open a live SSH shell here without leaving the dashboard.</small>
                </span>
                <TerminalSquare size={16} />
              </button>
            )}
            {quickError && <div className="quick-terminal-error">{quickError}</div>}
          </div>
        </Card>
      </div>

      <div className="dashboard-details">
        <Card>
          <div className="detail-heading">
            <span><HardDrive size={14} /> {t('serverDashboard.diskUsage')}</span>
            {hiddenDiskCount > 0 ? (
              <button
                type="button"
                className={`disk-filter-button ${showAllDisks ? 'is-active' : ''}`}
                onClick={() => setShowAllDisks((show) => !show)}
                title={showAllDisks ? 'Hide system and container mounts' : `Show ${hiddenDiskCount} system and container mounts`}
              >
                <ListFilter size={11} />
                <span>{visibleDisks.length}/{diskPartitions.length} volumes</span>
              </button>
            ) : (
              <span>{diskPartitions.length} volumes</span>
            )}
          </div>
          <div className="disk-list">
            {visibleDisks.map((disk) => (
              <div key={`${disk.source}:${disk.mountpoint}`} className="disk-row">
                <div title={`${disk.mountpoint}\n${disk.source}`}>
                  <b>{disk.mountpoint}</b>
                  <small>{disk.source}</small>
                </div>
                <div className="disk-track"><i style={{ width: `${disk.percent}%` }} /></div>
                <span>{disk.percent}%</span>
                <small>{formatBytes(disk.available)} free</small>
              </div>
            ))}
            {metricsLoading ? <><RowSkeleton compact /><RowSkeleton compact /></> : !diskPartitions.length && <div className="panel-empty compact">{t('common.noData')}</div>}
          </div>
        </Card>

        <Card>
          <div className="detail-heading">
            <span><Network size={14} /> {t('serverDashboard.networkIO')}</span>
            {hiddenNetworkCount > 0 ? (
              <button
                type="button"
                className={`disk-filter-button ${showAllNetworks ? 'is-active' : ''}`}
                onClick={() => setShowAllNetworks((show) => !show)}
                title={showAllNetworks ? 'Hide virtual interfaces' : `Show ${hiddenNetworkCount} virtual interfaces`}
              >
                <ListFilter size={11} />
                <span>{visibleNetworks.length}/{networkInterfaces.length} interfaces</span>
              </button>
            ) : (
              <span>{networkInterfaces.length} interfaces</span>
            )}
          </div>
          <div className="network-list">
            {visibleNetworks.map((network) => (
              <div key={network.name} className="network-row">
                <Badge variant="default">{network.name}</Badge>
                <span><ArrowDown size={12} /> {formatBytes(network.rxBytes)}/s</span>
                <span><ArrowUp size={12} /> {formatBytes(network.txBytes)}/s</span>
              </div>
            ))}
            {metricsLoading ? <><RowSkeleton compact /><RowSkeleton compact /></> : !networkInterfaces.length && <div className="panel-empty compact">{t('common.noData')}</div>}
          </div>
        </Card>
      </div>

      <button type="button" className="floating-files" onClick={() => navigate(`/sftp?server=${serverId}`)} title={t('sftp.openFiles')}>
        <FolderOpen size={16} />
      </button>
    </div>
  )
}
