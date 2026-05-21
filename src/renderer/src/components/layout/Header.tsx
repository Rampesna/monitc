import React from 'react'
import { Server, Minus, Square, X, Bell } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useApp } from '../../context/AppContext'
import { StatusDot } from '../common/StatusDot'
import { useNavigate } from 'react-router-dom'

const isMac = window.monitcAPI.app.platform === 'darwin'

export function Header(): React.ReactElement {
  const { t } = useTranslation()
  const { state, dispatch } = useApp()
  const navigate = useNavigate()

  const handleServerSelect = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    const id = e.target.value || null
    dispatch({ type: 'SELECT_SERVER', serverId: id })
    if (id) navigate(`/server/${id}`)
  }

  return (
    <header className="drag-region flex items-center h-12 border-b border-[#1e1e2e] bg-[#0d0d14] flex-shrink-0">
      {/* macOS trafik ışıkları için boşluk */}
      {isMac && <div className="w-[76px] flex-shrink-0" />}

      <div className={`flex items-center gap-3 flex-1 no-drag ${isMac ? 'px-2' : 'px-4'}`}>
        <div className="flex items-center gap-2">
          <Server size={14} className="text-slate-500" />
          <select
            value={state.selectedServerId ?? ''}
            onChange={handleServerSelect}
            className="bg-[#12121a] border border-[#1e1e2e] rounded-lg text-sm text-slate-200 px-2 py-1 focus:outline-none focus:border-indigo-500 cursor-pointer"
          >
            <option value="">{t('header.selectServer')}</option>
            {state.servers.map((s) => (
              <option key={s.id} value={s.id}>{s.name} ({s.host})</option>
            ))}
          </select>
        </div>

        {state.selectedServerId && (
          <StatusDot
            status={state.connectionStatuses[state.selectedServerId] ?? 'disconnected'}
            showLabel
          />
        )}
      </div>

      <div className={`flex items-center gap-2 no-drag ${isMac ? 'pr-3' : 'pr-4'}`}>
        {state.recentAlerts.length > 0 && (
          <button
            onClick={() => navigate('/alerts')}
            className="relative p-1.5 rounded-lg text-amber-400 hover:bg-amber-500/10 transition-colors"
          >
            <Bell size={14} />
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-white text-[9px] flex items-center justify-center font-bold">
              {state.recentAlerts.length > 9 ? '9+' : state.recentAlerts.length}
            </span>
          </button>
        )}

        {/* Pencere kontrolleri yalnızca Windows/Linux'ta göster, macOS native kullanır */}
        {!isMac && (
          <div className="flex items-center gap-1 ml-2">
            <button
              onClick={() => window.monitcAPI.app.minimize()}
              className="p-1.5 rounded-md hover:bg-white/5 text-slate-500 hover:text-slate-300 transition-colors"
            >
              <Minus size={12} />
            </button>
            <button
              onClick={() => window.monitcAPI.app.maximize()}
              className="p-1.5 rounded-md hover:bg-white/5 text-slate-500 hover:text-slate-300 transition-colors"
            >
              <Square size={12} />
            </button>
            <button
              onClick={() => window.monitcAPI.app.close()}
              className="p-1.5 rounded-md hover:bg-red-500/20 text-slate-500 hover:text-red-400 transition-colors"
            >
              <X size={12} />
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
