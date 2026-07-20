import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { TerminalSquare, Plus, X, RefreshCw, Server as ServerIcon, Laptop } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Button } from '../components/common/Button'
import { SSHTerminal } from '../components/terminal/SSHTerminal'
import { StatusDot } from '../components/common/StatusDot'
import type { Server } from '../lib/types'

type TerminalKind = 'ssh' | 'local'

interface TerminalTab {
  id: string
  label: string
  kind: TerminalKind
  serverId?: string
  sessionId: string | null
  connecting: boolean
  error?: string
}

export function TerminalPage(): React.ReactElement {
  const { t } = useTranslation()
  const { state } = useApp()
  const location = useLocation()
  const navigate = useNavigate()
  const handoffConsumedRef = useRef(false)
  const [tabs, setTabs] = useState<TerminalTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [showSessionPicker, setShowSessionPicker] = useState(false)

  const activeTab = tabs.find((tab) => tab.id === activeTabId)

  useEffect(() => {
    if (handoffConsumedRef.current) return
    const attachedSession = (location.state as {
      attachedSession?: { sessionId: string; serverId: string; label: string; kind: TerminalKind }
    } | null)?.attachedSession
    if (!attachedSession?.sessionId) return

    handoffConsumedRef.current = true
    const tabId = crypto.randomUUID()
    setTabs((previous) => [...previous, {
      id: tabId,
      label: attachedSession.label,
      kind: attachedSession.kind,
      serverId: attachedSession.serverId,
      sessionId: attachedSession.sessionId,
      connecting: false
    }])
    setActiveTabId(tabId)
    navigate(location.pathname, { replace: true, state: null })
  }, [location.pathname, location.state, navigate])

  const openSessionPicker = (): void => setShowSessionPicker(true)

  const connectTab = useCallback(async (tabId: string, kind: TerminalKind, server?: Server): Promise<void> => {
    setTabs((prev) => prev.map((tab) =>
      tab.id === tabId ? { ...tab, connecting: true, error: undefined } : tab
    ))

    try {
      const res = kind === 'local'
        ? await window.monitcAPI.terminal.openLocal(120, 32) as { success: boolean; sessionId?: string; error?: string }
        : await window.monitcAPI.terminal.open(server!.id, 120, 32) as { success: boolean; sessionId?: string; error?: string }

      if (!res.success || !res.sessionId) {
        setTabs((prev) => prev.map((tab) =>
          tab.id === tabId ? { ...tab, connecting: false, sessionId: null, error: res.error } : tab
        ))
        return
      }
      setTabs((prev) => prev.map((tab) =>
        tab.id === tabId ? { ...tab, connecting: false, sessionId: res.sessionId!, error: undefined } : tab
      ))
    } catch (err) {
      setTabs((prev) => prev.map((tab) =>
        tab.id === tabId ? { ...tab, connecting: false, error: (err as Error).message } : tab
      ))
    }
  }, [])

  const addSshTab = (server: Server): void => {
    setShowSessionPicker(false)
    const tabId = crypto.randomUUID()
    const tab: TerminalTab = {
      id: tabId,
      label: server.name,
      kind: 'ssh',
      serverId: server.id,
      sessionId: null,
      connecting: true
    }
    setTabs((prev) => [...prev, tab])
    setActiveTabId(tabId)
    connectTab(tabId, 'ssh', server)
  }

  const addLocalTab = (): void => {
    setShowSessionPicker(false)
    const tabId = crypto.randomUUID()
    const tab: TerminalTab = {
      id: tabId,
      label: t('terminal.localLabel'),
      kind: 'local',
      sessionId: null,
      connecting: true
    }
    setTabs((prev) => [...prev, tab])
    setActiveTabId(tabId)
    connectTab(tabId, 'local')
  }

  const closeTab = async (tabId: string): Promise<void> => {
    const tab = tabs.find((t) => t.id === tabId)
    if (tab?.sessionId) await window.monitcAPI.terminal.close(tab.sessionId).catch(() => {})
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId)
      if (activeTabId === tabId) setActiveTabId(next[0]?.id ?? null)
      return next
    })
  }

  const reconnectTab = (): void => {
    if (!activeTab) return
    if (activeTab.sessionId) {
      window.monitcAPI.terminal.close(activeTab.sessionId).catch(() => {})
    }
    setTabs((prev) => prev.map((tab) =>
      tab.id === activeTab.id ? { ...tab, sessionId: null, error: undefined } : tab
    ))
    if (activeTab.kind === 'local') {
      connectTab(activeTab.id, 'local')
      return
    }
    const server = state.servers.find((s) => s.id === activeTab.serverId)
    if (server) connectTab(activeTab.id, 'ssh', server)
  }

  return (
    <div className="terminal-page route-page flex flex-col h-full p-6 space-y-4">
      <div className="page-heading compact flex-shrink-0">
        <div className="page-title-with-icon">
          <TerminalSquare size={20} className="text-indigo-400" />
          <div>
            <h1 className="text-lg font-semibold text-slate-100">{t('terminal.title')}</h1>
            <p className="text-xs text-slate-500">{t('terminal.subtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {activeTab && (
            <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={reconnectTab} disabled={activeTab.connecting}>
              {t('terminal.reconnect')}
            </Button>
          )}
          <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={openSessionPicker}>
            {t('terminal.newSession')}
          </Button>
        </div>
      </div>

      {tabs.length > 0 && (
        <div className="flex gap-1 overflow-x-auto flex-shrink-0">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-t-lg text-xs font-medium border-b-2 transition-colors ${
                activeTabId === tab.id
                  ? 'bg-[#12121a] border-indigo-500 text-indigo-300'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.kind === 'local' ? <Laptop size={12} /> : null}
              <span className={`w-1.5 h-1.5 rounded-full ${tab.sessionId ? 'bg-green-400' : tab.connecting ? 'bg-amber-400 animate-pulse' : 'bg-red-400'}`} />
              {tab.label}
              <X
                size={12}
                className="opacity-50 hover:opacity-100"
                onClick={(e) => { e.stopPropagation(); closeTab(tab.id) }}
              />
            </button>
          ))}
        </div>
      )}

      <div className="terminal-stage mon-card flex-1 min-h-0 overflow-hidden relative">
        {tabs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-500">
            <TerminalSquare size={32} className="opacity-30" />
            <p className="text-sm">{t('terminal.empty')}</p>
            <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={openSessionPicker}>
              {t('terminal.newSession')}
            </Button>
          </div>
        ) : (
          <>
            {activeTab?.connecting && (
              <div className="absolute top-3 right-3 z-10 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-1 rounded-lg">
                {t('common.connecting')}
              </div>
            )}
            {activeTab?.error && (
              <div className="absolute top-3 left-3 right-3 z-10 text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg">
                {activeTab.error}
              </div>
            )}
            <SSHTerminal sessionId={activeTab?.sessionId ?? null} />
          </>
        )}
      </div>

      {showSessionPicker && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowSessionPicker(false)}
        >
          <div
            className="mon-modal w-full max-w-sm mx-4 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#1e1e2e]">
              <div className="flex items-center gap-2.5">
                <TerminalSquare size={16} className="text-indigo-400" />
                <span className="text-sm font-semibold text-slate-200">{t('terminal.selectSession')}</span>
              </div>
              <button
                onClick={() => setShowSessionPicker(false)}
                className="text-slate-500 hover:text-slate-300 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <button
              onClick={addLocalTab}
              className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-white/5 transition-colors text-left border-b border-[#1e1e2e]"
            >
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex-shrink-0">
                <Laptop size={14} className="text-emerald-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-200">{t('terminal.localLabel')}</div>
                <div className="text-xs text-slate-500">{t('terminal.localDesc')}</div>
              </div>
            </button>

            {state.servers.length > 0 ? (
              <div className="py-2 max-h-72 overflow-y-auto">
                <p className="px-5 py-1.5 text-[10px] uppercase tracking-wider text-slate-600 font-medium">{t('terminal.sshServers')}</p>
                {state.servers.map((server) => {
                  const connStatus = state.connectionStatuses[server.id] ?? 'disconnected'
                  return (
                    <button
                      key={server.id}
                      onClick={() => addSshTab(server)}
                      className="w-full flex items-center gap-3 px-5 py-3 hover:bg-white/5 transition-colors text-left"
                    >
                      <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex-shrink-0">
                        <ServerIcon size={14} className="text-indigo-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-slate-200 truncate">{server.name}</div>
                        <div className="text-xs text-slate-500 font-mono truncate">{server.host}:{server.port}</div>
                      </div>
                      <StatusDot status={connStatus} size="sm" showLabel />
                    </button>
                  )
                })}
              </div>
            ) : (
              <p className="px-5 py-4 text-xs text-slate-500">{t('terminal.noServers')}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default TerminalPage
