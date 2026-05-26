import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Server, Plus, Cpu, MemoryStick } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useApp } from '../context/AppContext'
import { Card } from '../components/common/Card'
import { StatusDot } from '../components/common/StatusDot'
import { MetricGauge } from '../components/common/MetricGauge'
import { Button } from '../components/common/Button'
import type { ConnectionState, SystemMetrics } from '../lib/types'

export function ServersPage(): React.ReactElement {
  const { t } = useTranslation()
  const { state, dispatch } = useApp()
  const navigate = useNavigate()

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
        <Button variant="primary" icon={<Plus size={14} />} onClick={() => navigate('/settings?tab=servers')}>
          {t('serversTab.addServer')}
        </Button>
      </div>
    )
  }

  const handleServerClick = (serverId: string): void => {
    dispatch({ type: 'SELECT_SERVER', serverId })
    window.monitcAPI.monitor.start(serverId).catch(console.error)
    navigate('/')
  }

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <Server size={20} className="text-indigo-400" />
        <h1 className="text-lg font-semibold text-slate-100">{t('nav.servers')}</h1>
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
              className={`flex flex-col gap-3 ${isSelected ? 'ring-1 ring-indigo-500/50' : ''}`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isSelected ? 'bg-indigo-600/30' : 'bg-indigo-600/20'}`}>
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
                  <StatusDot status={connStatus} size="sm" />
                </div>
              </div>

              {latest ? (
                <div className="flex items-center justify-around pt-2 border-t border-[#1e1e2e]">
                  <div className="flex flex-col items-center gap-0.5">
                    <Cpu size={12} className="text-slate-500" />
                    <span className="text-xs text-slate-500">{t('dashboard.cpu')}</span>
                    <span className={`text-sm font-bold ${latest.cpu.percent > 80 ? 'text-red-400' : latest.cpu.percent > 60 ? 'text-amber-400' : 'text-slate-200'}`}>
                      {Math.round(latest.cpu.percent)}%
                    </span>
                  </div>
                  <div className="flex flex-col items-center gap-0.5">
                    <MemoryStick size={12} className="text-slate-500" />
                    <span className="text-xs text-slate-500">{t('dashboard.ram')}</span>
                    <span className={`text-sm font-bold ${latest.memory.percent > 80 ? 'text-red-400' : latest.memory.percent > 60 ? 'text-amber-400' : 'text-slate-200'}`}>
                      {latest.memory.percent}%
                    </span>
                  </div>
                  <MetricGauge value={latest.cpu.percent} label={t('dashboard.cpu')} size="sm" />
                  <MetricGauge value={latest.memory.percent} label={t('dashboard.ram')} size="sm" />
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
    </div>
  )
}
