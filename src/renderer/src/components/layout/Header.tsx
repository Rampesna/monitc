import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Bell, Check, ChevronDown, Download, Loader2, Minus, Search, Server, Settings2, Square, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../../context/AppContext'
import { useAppUpdater } from '../../hooks/useAppUpdater'

const isMac = window.monitcAPI.app.platform === 'darwin'

export function Header(): React.ReactElement {
  const { t } = useTranslation()
  const { state, dispatch } = useApp()
  const updater = useAppUpdater()
  const navigate = useNavigate()
  const switcherRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [query, setQuery] = useState('')
  const selectedServer = state.servers.find((serverItem) => serverItem.id === state.selectedServerId)
  const connectedCount = state.servers.filter((serverItem) => state.connectionStatuses[serverItem.id] === 'connected').length
  const allSystemsLive = state.servers.length > 0 && connectedCount === state.servers.length
  const showUpdateShortcut = ['available', 'downloading', 'ready'].includes(updater.state.status)

  const updateShortcutLabel = (() => {
    if (updater.state.status === 'downloading') {
      return t('updater.headerDownloading', { percent: updater.state.percent ?? 0 })
    }
    if (updater.state.status === 'ready') return t('updater.headerReady')
    return t('updater.headerAvailable', { version: updater.state.version })
  })()

  const filteredServers = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    if (!normalizedQuery) return state.servers
    return state.servers.filter((serverItem) => (
      `${serverItem.name} ${serverItem.username} ${serverItem.host}`.toLocaleLowerCase().includes(normalizedQuery)
    ))
  }, [query, state.servers])

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent): void => {
      if (!switcherRef.current?.contains(event.target as Node)) setSwitcherOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setSwitcherOpen(false)
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault()
        setSwitcherOpen((open) => !open)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  useEffect(() => {
    if (!switcherOpen) return
    setQuery('')
    window.requestAnimationFrame(() => searchRef.current?.focus())
  }, [switcherOpen])

  const handleServerSelect = (id: string): void => {
    dispatch({ type: 'SELECT_SERVER', serverId: id })
    setSwitcherOpen(false)
    navigate(`/server/${id}`)
  }

  return (
    <header className="app-header drag-region flex items-center flex-shrink-0">
      {isMac && <div className="w-[78px] flex-shrink-0" />}

      <div className="app-header-title no-drag">
        <span>monitc</span>
        <b>/</b>
        <div className={`server-switcher ${switcherOpen ? 'is-open' : ''}`} ref={switcherRef}>
          <button
            type="button"
            className="server-switcher-trigger"
            onClick={() => setSwitcherOpen((open) => !open)}
            aria-haspopup="listbox"
            aria-expanded={switcherOpen}
            aria-label={t('header.selectServer')}
          >
            <span>{selectedServer?.name ?? t('header.selectServer')}</span>
            <ChevronDown size={12} />
          </button>

          {switcherOpen && (
            <div className="server-switcher-popover">
              <div className="server-search">
                <Search size={14} />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('header.searchServers')}
                  aria-label={t('header.searchServers')}
                />
                <kbd>{isMac ? '⌘K' : 'Ctrl K'}</kbd>
              </div>

              <div className="server-switcher-caption">
                <span>{t('nav.servers')}</span>
                <span>{filteredServers.length}</span>
              </div>

              <div className="server-options" role="listbox" aria-label={t('nav.servers')}>
                {filteredServers.map((serverItem) => {
                  const status = state.connectionStatuses[serverItem.id] ?? 'disconnected'
                  const selected = serverItem.id === state.selectedServerId
                  return (
                    <button
                      key={serverItem.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={`server-option ${selected ? 'is-selected' : ''}`}
                      onClick={() => handleServerSelect(serverItem.id)}
                    >
                      <span className={`server-option-icon is-${status}`}><Server size={14} /></span>
                      <span className="server-option-copy">
                        <b>{serverItem.name}</b>
                        <small>{serverItem.username}@{serverItem.host}:{serverItem.port}</small>
                      </span>
                      <span className={`server-option-status is-${status}`} />
                      {selected && <Check className="server-option-check" size={14} />}
                    </button>
                  )
                })}

                {!filteredServers.length && (
                  <div className="server-options-empty">
                    <Search size={17} />
                    <span>{t('header.noServersFound')}</span>
                  </div>
                )}
              </div>

              <button
                type="button"
                className="server-switcher-manage"
                onClick={() => {
                  setSwitcherOpen(false)
                  navigate('/servers')
                }}
              >
                <Settings2 size={13} />
                <span>{t('header.manageServers')}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className={`app-header-status flex items-center gap-3 no-drag ${isMac ? 'pr-5' : 'pr-4'}`}>
        {showUpdateShortcut && (
          <button
            type="button"
            className={`header-update-shortcut is-${updater.state.status}`}
            onClick={() => navigate('/settings?tab=general')}
            title={t('updater.openUpdateSettings')}
          >
            {updater.state.status === 'downloading' ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
            <span>{updateShortcutLabel}</span>
          </button>
        )}

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
