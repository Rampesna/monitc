import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Server, Plus, FolderOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useApp } from '../context/AppContext'
import { Card } from '../components/common/Card'
import { StatusDot } from '../components/common/StatusDot'
import { MetricGauge } from '../components/common/MetricGauge'
import { Button } from '../components/common/Button'
import type { ConnectionState, SystemMetrics } from '../lib/types'
import { ServerFormModal } from '../components/servers/ServerFormModal'

export function ServersPage(): React.ReactElement {
  const { t } = useTranslation()
  const { state, dispatch } = useApp()
  const navigate = useNavigate()
  const [addOpen, setAddOpen] = useState(false)

  if (state.servers.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 p-8">
        <div className="w-16 h-16 rounded-2xl bg-slate-800/50 border border-[#1e1e2e] flex items-center justify-center">
          <Server size={28} className="text-slate-500" />
        </div>
        <div className="text-center">
          <h2 className="text-lg font-semibold text-slate-300 mb-1">{t('dashboard.noServers')}</h2>
          <p className="text-slate-500 text-sm">{t('dashboard.addServer')}</p>
        </div>
        <Button variant="primary" icon={<Plus size={14} />} onClick={() => setAddOpen(true)}>
          {t('serversTab.addServer')}
        </Button>
        <ServerFormModal open={addOpen} onClose={() => setAddOpen(false)} />
      </div>
    )
  }

  const handleServerClick = (serverId: string): void => {
    dispatch({ type: 'SELECT_SERVER', serverId })
    window.monitcAPI.monitor.start(serverId).catch(console.error)
    navigate('/')
  }

  return (
    <div className="servers-page p-6">
      <div className="page-heading">
        <div>
          <p className="section-eyebrow">INFRASTRUCTURE</p>
          <h1>{t('nav.servers')}</h1>
          <p>{t('dashboard.subtitle')}</p>
        </div>
        <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setAddOpen(true)}>{t('serversTab.addServer')}</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {state.servers.map((server) => {
          const connStatus = (state.connectionStatuses[server.id] ?? 'disconnected') as ConnectionState
          const history = state.metricsHistory[server.id] ?? []
          const latest: SystemMetrics | undefined = history[history.length - 1]
          const isSelected = state.selectedServerId === server.id

          return (
            <Card
              key={server.id}
              hoverable
              onClick={() => handleServerClick(server.id)}
              className={`server-card flex flex-col gap-4 ${isSelected ? 'is-selected' : ''}`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="server-card-icon">
                    <Server size={14} className="text-indigo-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-100">{server.name}</p>
                    <p className="text-xs text-slate-500">{server.host}:{server.port}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isSelected && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
                      {t('servers.active')}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      dispatch({ type: 'SELECT_SERVER', serverId: server.id })
                      navigate(`/sftp?server=${server.id}`)
                    }}
                    className="server-files-button"
                    title={t('sftp.openFiles')}
                  >
                    <FolderOpen size={14} />
                  </button>
                  <StatusDot status={connStatus} size="sm" />
                </div>
              </div>

              {latest ? (
                <div className="server-metrics">
                  <MetricGauge value={latest.cpu.percent} label={t('dashboard.cpu')} tone="purple" size="md" />
                  <MetricGauge value={latest.memory.percent} label={t('dashboard.ram')} tone="cyan" size="md" />
                  <MetricGauge value={latest.disk.find((disk) => disk.mountpoint === '/')?.percent ?? 0} label={t('dashboard.disk')} tone="green" size="md" />
                </div>
              ) : (
                <div className="flex items-center justify-center py-4 border-t border-[#1e1e2e]">
                  <p className="text-xs text-slate-600">
                    {connStatus === 'connecting' ? t('common.connecting') : connStatus === 'connected' ? t('serverDashboard.noMetrics') : t('common.disconnected')}
                  </p>
                </div>
              )}
            </Card>
          )
        })}
      </div>
      <ServerFormModal open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  )
}
