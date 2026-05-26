import React, { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { TerminalSquare, Plus, X, RefreshCw } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Button } from '../components/common/Button'
import { SSHTerminal } from '../components/terminal/SSHTerminal'
import type { Server } from '../lib/types'

interface TerminalTab {
  id: string
  label: string
  serverId: string
  sessionId: string | null
  connecting: boolean
  error?: string
}

export function TerminalPage(): React.ReactElement {
  const { t } = useTranslation()
  const { state } = useApp()
  const [tabs, setTabs] = useState<TerminalTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)

  const activeTab = tabs.find((tab) => tab.id === activeTabId)

  const connectTab = useCallback(async (tabId: string, server: Server): Promise<void> => {
    setTabs((prev) => prev.map((tab) =>
      tab.id === tabId ? { ...tab, connecting: true, error: undefined } : tab
    ))

    try {
      const res = await window.monitcAPI.terminal.open(server.id, 120, 32) as {
        success: boolean
        sessionId?: string
        error?: string
      }
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

  const addTab = (server: Server): void => {
    const tabId = crypto.randomUUID()
    const tab: TerminalTab = {
      id: tabId,
      label: server.name,
      serverId: server.id,
      sessionId: null,
      connecting: true
    }
    setTabs((prev) => [...prev, tab])
    setActiveTabId(tabId)
    connectTab(tabId, server)
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
    const server = state.servers.find((s) => s.id === activeTab.serverId)
    if (!server) return
    if (activeTab.sessionId) {
      window.monitcAPI.terminal.close(activeTab.sessionId).catch(() => {})
    }
    setTabs((prev) => prev.map((tab) =>
      tab.id === activeTab.id ? { ...tab, sessionId: null, error: undefined } : tab
    ))
    connectTab(activeTab.id, server)
  }

  return (
    <div className="flex flex-col h-full p-6 space-y-4">
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
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
          {state.servers.length > 0 && (
            <select
              className="bg-[#0d0d14] border border-[#1e1e2e] rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
              defaultValue=""
              onChange={(e) => {
                const server = state.servers.find((s) => s.id === e.target.value)
                if (server) addTab(server)
                e.target.value = ''
              }}
            >
              <option value="" disabled>{t('terminal.newSession')}</option>
              {state.servers.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({s.host})</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {state.servers.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
          {t('terminal.noServers')}
        </div>
      ) : (
        <>
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

          <div className="flex-1 min-h-0 bg-[#0a0a0f] border border-[#1e1e2e] rounded-xl overflow-hidden relative">
            {tabs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-500">
                <TerminalSquare size={32} className="opacity-30" />
                <p className="text-sm">{t('terminal.empty')}</p>
                <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => addTab(state.servers[0])}>
                  {t('terminal.connectFirst')}
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
        </>
      )}
    </div>
  )
}

export default TerminalPage
