import React from 'react'
import { Activity, Bell, Minus, Square, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../../context/AppContext'

const isMac = window.monitcAPI.app.platform === 'darwin'

export function Header(): React.ReactElement {
  const { t } = useTranslation()
  const { state, dispatch } = useApp()
  const navigate = useNavigate()
  const selectedServer = state.servers.find((server) => server.id === state.selectedServerId)
  const connectedCount = state.servers.filter((server) => state.connectionStatuses[server.id] === 'connected').length
  const allSystemsLive = state.servers.length > 0 && connectedCount === state.servers.length

  const handleServerSelect = (event: React.ChangeEvent<HTMLSelectElement>): void => {
    const id = event.target.value || null
    dispatch({ type: 'SELECT_SERVER', serverId: id })
    if (id) navigate(`/server/${id}`)
  }

  return (
    <header className="app-header drag-region flex items-center flex-shrink-0">
      {isMac && <div className="w-[78px] flex-shrink-0" />}

      <div className="app-header-title no-drag">
        <span>monitc</span>
        <b>/</b>
        <div className="app-server-select">
          <select
            value={state.selectedServerId ?? ''}
            onChange={handleServerSelect}
            aria-label={t('header.selectServer')}
          >
            <option value="">{t('header.selectServer')}</option>
            {state.servers.map((server) => (
              <option key={server.id} value={server.id}>{server.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className={`app-header-status flex items-center gap-3 no-drag ${isMac ? 'pr-5' : 'pr-4'}`}>
        <div className={`global-live ${allSystemsLive ? 'is-live' : ''}`}>
          <span />
          <Activity size={12} />
          {allSystemsLive ? 'All systems live' : selectedServer ? `${connectedCount}/${state.servers.length} online` : 'No server selected'}
        </div>

        {state.recentAlerts.length > 0 && (
          <button onClick={() => navigate('/alerts')} className="header-alert relative" title={t('nav.alerts')}>
            <Bell size={14} />
            <span className="header-alert-count">{state.recentAlerts.length > 9 ? '9+' : state.recentAlerts.length}</span>
          </button>
        )}

        {!isMac && (
          <div className="window-controls flex items-center gap-1 ml-2">
            <button onClick={() => window.monitcAPI.app.minimize()} className="window-control" aria-label="Minimize"><Minus size={12} /></button>
            <button onClick={() => window.monitcAPI.app.maximize()} className="window-control" aria-label="Maximize"><Square size={12} /></button>
            <button onClick={() => window.monitcAPI.app.close()} className="window-control window-close" aria-label="Close"><X size={12} /></button>
          </div>
        )}
      </div>
    </header>
  )
}
