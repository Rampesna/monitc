import React, { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Container, Image, Network, HardDrive, Play, Square, RotateCcw, Trash2, ScrollText } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useApp } from '../context/AppContext'
import { Card } from '../components/common/Card'
import { Tabs } from '../components/common/Tabs'
import { Badge } from '../components/common/Badge'
import { Button } from '../components/common/Button'
import { SearchInput } from '../components/common/SearchInput'
import type { DockerContainer } from '../lib/types'

function stateVariant(state: string): 'success' | 'danger' | 'warning' | 'default' {
  if (state === 'running') return 'success'
  if (state === 'exited' || state === 'dead') return 'danger'
  if (state === 'restarting') return 'warning'
  return 'default'
}

export function DockerPage(): React.ReactElement {
  const { t } = useTranslation()
  const { serverId } = useParams<{ serverId: string }>()
  const { state } = useApp()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('containers')
  const [search, setSearch] = useState('')
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({})

  const sid = serverId ?? state.selectedServerId ?? ''
  const dockerData = state.dockerData[sid]

  const handleAction = async (action: string, container: DockerContainer): Promise<void> => {
    const key = `${container.id}-${action}`
    setActionLoading((p) => ({ ...p, [key]: true }))
    try {
      await window.monitcAPI.docker.action(sid, action, container.id)
    } catch (err) {
      console.error(err)
    } finally {
      setActionLoading((p) => { const n = { ...p }; delete n[key]; return n })
    }
  }

  const tabs = [
    { id: 'containers', label: t('docker.containers'), icon: <Container size={13} />, badge: dockerData?.containers.length },
    { id: 'images', label: t('docker.images'), icon: <Image size={13} />, badge: dockerData?.images.length },
    { id: 'networks', label: t('docker.networks'), icon: <Network size={13} />, badge: dockerData?.networks.length },
    { id: 'volumes', label: t('docker.volumes'), icon: <HardDrive size={13} />, badge: dockerData?.volumes.length }
  ]

  if (!dockerData) {
    return (
      <div className="h-full flex items-center justify-center flex-col gap-3">
        <Container size={32} className="text-slate-600" />
        <p className="text-slate-500 text-sm">{t('docker.waiting')}</p>
      </div>
    )
  }

  if (!dockerData.available) {
    return (
      <div className="h-full flex items-center justify-center flex-col gap-3">
        <Container size={32} className="text-slate-600" />
        <p className="text-slate-500 text-sm">{t('docker.noServer')}</p>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Container size={20} className="text-blue-400" />
          <h1 className="text-lg font-semibold text-slate-100">{t('docker.title')}</h1>
        </div>
        <SearchInput value={search} onChange={setSearch} className="w-56" />
      </div>

      <Tabs tabs={tabs} active={activeTab} onChange={setActiveTab} />

      {activeTab === 'containers' && (
        <Card padding="none">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#1e1e2e]">
                  <th className="text-left py-2 px-4 text-slate-500 font-medium">{t('common.name')}</th>
                  <th className="text-left py-2 px-4 text-slate-500 font-medium">{t('docker.image')}</th>
                  <th className="text-left py-2 px-4 text-slate-500 font-medium">{t('common.status')}</th>
                  <th className="text-left py-2 px-4 text-slate-500 font-medium">{t('docker.ports')}</th>
                  <th className="text-right py-2 px-4 text-slate-500 font-medium">CPU</th>
                  <th className="text-right py-2 px-4 text-slate-500 font-medium">Memory</th>
                  <th className="text-right py-2 px-4 text-slate-500 font-medium">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {dockerData.containers
                  .filter((c) => !search || c.names.includes(search) || c.image.includes(search))
                  .map((c) => (
                    <tr
                      key={c.id}
                      className="border-b border-[#1e1e2e]/50 hover:bg-[#1a1a25] cursor-pointer transition-colors"
                      onClick={() => navigate(`/docker/${sid}/${c.id}`)}
                    >
                      <td className="py-2 px-4 font-medium text-slate-200">
                        <div className="flex items-center gap-1.5">
                          {c.names.replace(/^\//, '')}
                          {c.names.includes('k8s_') && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-500/15 text-purple-400 border border-purple-500/20 flex-shrink-0">k8s</span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-4 text-slate-400 max-w-[160px] truncate">{c.image}</td>
                      <td className="py-2 px-4">
                        <Badge variant={stateVariant(c.state)}>{c.state}</Badge>
                      </td>
                      <td className="py-2 px-4 text-slate-500 max-w-[120px] truncate">{c.ports || '-'}</td>
                      <td className="py-2 px-4 text-right text-slate-300">{c.cpuPercent?.toFixed(1) ?? 0}%</td>
                      <td className="py-2 px-4 text-right text-slate-300">{c.memPercent?.toFixed(1) ?? 0}%</td>
                      <td className="py-2 px-4">
                        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => handleAction('start', c)} disabled={c.state === 'running'} title={t('docker.startContainer')}
                            className="p-1 rounded hover:bg-green-500/20 text-green-400 disabled:opacity-30 disabled:cursor-not-allowed">
                            <Play size={12} />
                          </button>
                          <button onClick={() => handleAction('stop', c)} disabled={c.state !== 'running'} title={t('docker.stopContainer')}
                            className="p-1 rounded hover:bg-red-500/20 text-red-400 disabled:opacity-30 disabled:cursor-not-allowed">
                            <Square size={12} />
                          </button>
                          <button onClick={() => handleAction('restart', c)} title={t('docker.restartContainer')}
                            className="p-1 rounded hover:bg-amber-500/20 text-amber-400">
                            <RotateCcw size={12} />
                          </button>
                          <button
                            onClick={() => navigate(`/logs?type=docker&serverId=${sid}&containerId=${c.id}&label=${encodeURIComponent(c.names.replace(/^\//, ''))}`)}
                            title={t('docker.viewLogs')}
                            className="p-1 rounded hover:bg-blue-500/20 text-blue-400">
                            <ScrollText size={12} />
                          </button>
                          <button onClick={() => handleAction('remove', c)} title={t('docker.removeContainer')}
                            className="p-1 rounded hover:bg-red-500/20 text-red-500">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {!dockerData.containers.length && (
              <div className="py-12 text-center text-slate-600 text-sm">{t('docker.noContainers')}</div>
            )}
          </div>
        </Card>
      )}

      {activeTab === 'images' && (
        <Card padding="none">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#1e1e2e]">
                  <th className="text-left py-2 px-4 text-slate-500 font-medium">Repository</th>
                  <th className="text-left py-2 px-4 text-slate-500 font-medium">Tag</th>
                  <th className="text-left py-2 px-4 text-slate-500 font-medium">{t('docker.size')}</th>
                  <th className="text-left py-2 px-4 text-slate-500 font-medium">{t('common.created')}</th>
                  <th className="text-left py-2 px-4 text-slate-500 font-medium">ID</th>
                </tr>
              </thead>
              <tbody>
                {dockerData.images
                  .filter((i) => !search || i.repository.includes(search) || i.tag.includes(search))
                  .map((img) => (
                    <tr key={img.id} className="border-b border-[#1e1e2e]/50 hover:bg-[#1a1a25] transition-colors">
                      <td className="py-2 px-4 font-medium text-slate-200">{img.repository}</td>
                      <td className="py-2 px-4"><Badge variant="info">{img.tag}</Badge></td>
                      <td className="py-2 px-4 text-slate-400">{img.size}</td>
                      <td className="py-2 px-4 text-slate-500">{img.created}</td>
                      <td className="py-2 px-4 text-slate-600 font-mono">{img.id.slice(0, 12)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {!dockerData.images.length && <div className="py-12 text-center text-slate-600 text-sm">{t('docker.noImages')}</div>}
          </div>
        </Card>
      )}

      {activeTab === 'networks' && (
        <Card padding="none">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#1e1e2e]">
                  <th className="text-left py-2 px-4 text-slate-500 font-medium">{t('common.name')}</th>
                  <th className="text-left py-2 px-4 text-slate-500 font-medium">{t('docker.driver')}</th>
                  <th className="text-left py-2 px-4 text-slate-500 font-medium">{t('docker.scope')}</th>
                  <th className="text-left py-2 px-4 text-slate-500 font-medium">ID</th>
                </tr>
              </thead>
              <tbody>
                {dockerData.networks.map((n) => (
                  <tr key={n.id} className="border-b border-[#1e1e2e]/50 hover:bg-[#1a1a25] transition-colors">
                    <td className="py-2 px-4 font-medium text-slate-200">{n.name}</td>
                    <td className="py-2 px-4 text-slate-400">{n.driver}</td>
                    <td className="py-2 px-4 text-slate-500">{n.scope}</td>
                    <td className="py-2 px-4 text-slate-600 font-mono">{n.id.slice(0, 12)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!dockerData.networks.length && <div className="py-12 text-center text-slate-600 text-sm">{t('docker.noNetworks')}</div>}
          </div>
        </Card>
      )}

      {activeTab === 'volumes' && (
        <Card padding="none">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#1e1e2e]">
                  <th className="text-left py-2 px-4 text-slate-500 font-medium">{t('common.name')}</th>
                  <th className="text-left py-2 px-4 text-slate-500 font-medium">{t('docker.driver')}</th>
                  <th className="text-left py-2 px-4 text-slate-500 font-medium">{t('docker.mountpoint')}</th>
                </tr>
              </thead>
              <tbody>
                {dockerData.volumes.map((v) => (
                  <tr key={v.name} className="border-b border-[#1e1e2e]/50 hover:bg-[#1a1a25] transition-colors">
                    <td className="py-2 px-4 font-medium text-slate-200">{v.name}</td>
                    <td className="py-2 px-4 text-slate-400">{v.driver}</td>
                    <td className="py-2 px-4 text-slate-500 font-mono text-[11px]">{v.mountpoint}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!dockerData.volumes.length && <div className="py-12 text-center text-slate-600 text-sm">{t('docker.noVolumes')}</div>}
          </div>
        </Card>
      )}
    </div>
  )
}
