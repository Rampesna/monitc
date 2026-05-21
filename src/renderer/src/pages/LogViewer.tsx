import React, { useState, useEffect } from 'react'
import { ScrollText, Plus, X, Pause, Play } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useApp } from '../context/AppContext'
import { Card } from '../components/common/Card'
import { Button } from '../components/common/Button'
import { LogTerminal } from '../components/terminal/LogTerminal'
import { Terminal } from '@xterm/xterm'

interface LogTab {
  id: string
  label: string
  streamId: string | null
  serverId: string
  type: 'docker' | 'k8s'
  source: string
  paused: boolean
  termRef: Terminal | null
}

export function LogViewer(): React.ReactElement {
  const { t } = useTranslation()
  const { state } = useApp()
  const [tabs, setTabs] = useState<LogTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [newType, setNewType] = useState<'docker' | 'k8s'>('docker')
  const [selectedSource, setSelectedSource] = useState('')
  const [selectedServerId, setSelectedServerId] = useState(state.selectedServerId ?? state.servers[0]?.id ?? '')

  const sid = selectedServerId
  const dockerData = state.dockerData[sid]
  const k8sData = state.kubernetesData[sid]

  const addTab = async (): Promise<void> => {
    if (!selectedSource || !sid) return
    let streamId: string | null = null
    let label = ''

    if (newType === 'docker') {
      streamId = await window.monitcAPI.logs.startDocker(sid, selectedSource, 500)
      label = `docker:${selectedSource.slice(0, 8)}`
    } else {
      const [ns, pod, container] = selectedSource.split('/')
      streamId = await window.monitcAPI.logs.startK8s(sid, ns, pod, container)
      label = `${pod}`
    }

    const tabId = Date.now().toString()
    const newTab: LogTab = { id: tabId, label, streamId, serverId: sid, type: newType, source: selectedSource, paused: false, termRef: null }
    setTabs((t) => [...t, newTab])
    setActiveTabId(tabId)
    setShowAddModal(false)
  }

  const closeTab = async (tabId: string): Promise<void> => {
    const tab = tabs.find((t) => t.id === tabId)
    if (tab?.streamId) await window.monitcAPI.logs.stop(tab.streamId).catch(console.error)
    setTabs((t) => t.filter((tab) => tab.id !== tabId))
    setActiveTabId((prev) => prev === tabId ? (tabs[0]?.id ?? null) : prev)
  }

  const activeTab = tabs.find((t) => t.id === activeTabId)

  return (
    <div className="flex flex-col h-full p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ScrollText size={20} className="text-green-400" />
          <h1 className="text-lg font-semibold text-slate-100">{t('logs.title')}</h1>
        </div>
        <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setShowAddModal(true)}>
          {t('logs.newTab')}
        </Button>
      </div>

      {tabs.length > 0 ? (
        <>
          <div className="flex gap-1 overflow-x-auto">
            {tabs.map((tab) => (
              <div
                key={tab.id}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer flex-shrink-0 transition-colors ${activeTabId === tab.id ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30' : 'bg-[#12121a] text-slate-400 border border-[#1e1e2e] hover:border-[#2d2d45]'}`}
                onClick={() => setActiveTabId(tab.id)}
              >
                {tab.label}
                <button
                  className="hover:text-red-400 transition-colors"
                  onClick={(e) => { e.stopPropagation(); closeTab(tab.id) }}
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>

          <Card className="flex-1 overflow-hidden flex flex-col" padding="sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-slate-500">{activeTab?.source}</span>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  icon={activeTab?.paused ? <Play size={12} /> : <Pause size={12} />}
                  onClick={() => {
                    if (!activeTabId) return
                    setTabs((t) => t.map((tab) => tab.id === activeTabId ? { ...tab, paused: !tab.paused } : tab))
                  }}
                >
                  {activeTab?.paused ? t('logs.resume') : t('logs.pause')}
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden rounded-lg bg-[#0a0a0f]">
              {activeTab && <LogTerminal key={activeTab.id} streamId={activeTab.streamId} className="h-full" />}
            </div>
          </Card>
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center flex-col gap-3">
          <ScrollText size={32} className="text-slate-600" />
          <p className="text-slate-500 text-sm">{t('logs.noLogs')}</p>
          <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setShowAddModal(true)}>
            {t('logs.newTab')}
          </Button>
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowAddModal(false)} />
          <div className="relative bg-[#12121a] border border-[#2d2d45] rounded-2xl p-6 w-96 shadow-2xl">
            <h2 className="text-sm font-semibold text-slate-100 mb-4">{t('logs.source')}</h2>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">{t('settings.servers')}</label>
                <select value={selectedServerId} onChange={(e) => setSelectedServerId(e.target.value)}
                  className="w-full bg-[#0d0d14] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500">
                  {state.servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">{t('logs.source')}</label>
                <select value={newType} onChange={(e) => { setNewType(e.target.value as 'docker' | 'k8s'); setSelectedSource('') }}
                  className="w-full bg-[#0d0d14] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500">
                  <option value="docker">{t('logs.dockerContainer')}</option>
                  <option value="k8s">{t('logs.k8sPod')}</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">{t('logs.source')}</label>
                <select value={selectedSource} onChange={(e) => setSelectedSource(e.target.value)}
                  className="w-full bg-[#0d0d14] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500">
                  <option value="">{t('logs.selectSource')}</option>
                  {newType === 'docker' && dockerData?.containers.map((c) => (
                    <option key={c.id} value={c.id}>{c.names.replace(/^\//, '')}</option>
                  ))}
                  {newType === 'k8s' && k8sData?.pods.map((p) => (
                    <option key={`${p.namespace}/${p.name}`} value={`${p.namespace}/${p.name}`}>{p.namespace}/{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2 pt-2">
                <Button variant="secondary" className="flex-1" onClick={() => setShowAddModal(false)}>{t('common.cancel')}</Button>
                <Button variant="primary" className="flex-1" onClick={addTab} disabled={!selectedSource}>{t('common.add')}</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
