import React, { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Box, AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useApp } from '../context/AppContext'
import { Card } from '../components/common/Card'
import { Tabs } from '../components/common/Tabs'
import { Badge } from '../components/common/Badge'
import { SearchInput } from '../components/common/SearchInput'
import type { K8sPod } from '../lib/types'

function podStatusVariant(status: string): 'success' | 'danger' | 'warning' | 'info' | 'default' {
  if (status === 'Running') return 'success'
  if (['CrashLoopBackOff', 'Error', 'OOMKilled', 'ImagePullBackOff'].includes(status)) return 'danger'
  if (['Pending', 'Terminating'].includes(status)) return 'warning'
  if (status === 'Succeeded') return 'info'
  return 'default'
}

export function KubernetesPage(): React.ReactElement {
  const { t } = useTranslation()
  const { serverId } = useParams<{ serverId: string }>()
  const { state } = useApp()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('pods')
  const [search, setSearch] = useState('')

  const sid = serverId ?? state.selectedServerId ?? ''
  const k8sData = state.kubernetesData[sid]

  const tabs = [
    { id: 'pods', label: t('kubernetes.pods'), badge: k8sData?.pods.length },
    { id: 'services', label: t('kubernetes.services'), badge: k8sData?.services.length },
    { id: 'deployments', label: t('kubernetes.deployments'), badge: k8sData?.deployments.length },
    { id: 'events', label: t('kubernetes.events'), badge: k8sData?.events.length }
  ]

  if (!k8sData) {
    return (
      <div className="h-full flex items-center justify-center flex-col gap-3">
        <Box size={32} className="text-slate-600" />
        <p className="text-slate-500 text-sm">{t('kubernetes.waiting')}</p>
      </div>
    )
  }

  if (!k8sData.available) {
    return (
      <div className="h-full flex items-center justify-center flex-col gap-3">
        <Box size={32} className="text-slate-600" />
        <p className="text-slate-500 text-sm">{t('kubernetes.noServer')}</p>
      </div>
    )
  }

  const filterFn = (item: { name: string; namespace: string }): boolean =>
    !search || item.name.includes(search) || item.namespace.includes(search)

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Box size={20} className="text-purple-400" />
          <h1 className="text-lg font-semibold text-slate-100">{t('kubernetes.title')}</h1>
        </div>
        <SearchInput value={search} onChange={setSearch} className="w-56" />
      </div>

      <Tabs tabs={tabs} active={activeTab} onChange={setActiveTab} />

      {activeTab === 'pods' && (
        <Card padding="none">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#1e1e2e]">
                  {[t('common.namespace'), t('common.name'), t('common.status'), t('kubernetes.ready'), t('kubernetes.restarts'), t('kubernetes.age'), 'Node', 'IP'].map((h) => (
                    <th key={h} className="text-left py-2 px-3 text-slate-500 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {k8sData.pods.filter(filterFn).map((pod) => (
                  <tr
                    key={`${pod.namespace}/${pod.name}`}
                    className="border-b border-[#1e1e2e]/50 hover:bg-[#1a1a25] cursor-pointer transition-colors"
                    onClick={() => navigate(`/kubernetes/${sid}/${pod.namespace}/${pod.name}`)}
                  >
                    <td className="py-2 px-3 text-slate-500">{pod.namespace}</td>
                    <td className="py-2 px-3 font-medium text-slate-200">{pod.name}</td>
                    <td className="py-2 px-3"><Badge variant={podStatusVariant(pod.status)}>{pod.status}</Badge></td>
                    <td className="py-2 px-3 text-slate-400">{pod.ready}</td>
                    <td className="py-2 px-3">
                      <span className={pod.restarts > 5 ? 'text-red-400 font-medium' : pod.restarts > 0 ? 'text-amber-400' : 'text-slate-400'}>
                        {pod.restarts}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-slate-500">{pod.age}</td>
                    <td className="py-2 px-3 text-slate-500">{pod.node}</td>
                    <td className="py-2 px-3 text-slate-600 font-mono">{pod.ip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!k8sData.pods.length && <div className="py-12 text-center text-slate-600 text-sm">{t('kubernetes.noPods')}</div>}
          </div>
        </Card>
      )}

      {activeTab === 'services' && (
        <Card padding="none">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#1e1e2e]">
                  {[t('common.namespace'), t('common.name'), t('common.type'), t('kubernetes.clusterIP'), t('kubernetes.externalIP'), t('docker.ports'), t('kubernetes.age')].map((h) => (
                    <th key={h} className="text-left py-2 px-3 text-slate-500 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {k8sData.services.filter(filterFn).map((svc) => (
                  <tr key={`${svc.namespace}/${svc.name}`} className="border-b border-[#1e1e2e]/50 hover:bg-[#1a1a25] transition-colors">
                    <td className="py-2 px-3 text-slate-500">{svc.namespace}</td>
                    <td className="py-2 px-3 font-medium text-slate-200">{svc.name}</td>
                    <td className="py-2 px-3"><Badge variant="info">{svc.type}</Badge></td>
                    <td className="py-2 px-3 font-mono text-slate-400">{svc.clusterIP}</td>
                    <td className="py-2 px-3 text-slate-400">{svc.externalIP || '-'}</td>
                    <td className="py-2 px-3 text-slate-400">{svc.ports || '-'}</td>
                    <td className="py-2 px-3 text-slate-500">{svc.age}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!k8sData.services.length && <div className="py-12 text-center text-slate-600 text-sm">{t('kubernetes.noServices')}</div>}
          </div>
        </Card>
      )}

      {activeTab === 'deployments' && (
        <Card padding="none">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#1e1e2e]">
                  {[t('common.namespace'), t('common.name'), t('kubernetes.ready'), 'Up-to-date', t('kubernetes.available'), t('kubernetes.age')].map((h) => (
                    <th key={h} className="text-left py-2 px-3 text-slate-500 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {k8sData.deployments.filter(filterFn).map((dep) => {
                  const [ready, total] = dep.ready.split('/').map(Number)
                  const isOk = ready === total
                  return (
                    <tr key={`${dep.namespace}/${dep.name}`} className="border-b border-[#1e1e2e]/50 hover:bg-[#1a1a25] transition-colors">
                      <td className="py-2 px-3 text-slate-500">{dep.namespace}</td>
                      <td className="py-2 px-3 font-medium text-slate-200">{dep.name}</td>
                      <td className="py-2 px-3">
                        <span className={isOk ? 'text-green-400' : 'text-red-400'}>{dep.ready}</span>
                      </td>
                      <td className="py-2 px-3 text-slate-400">{dep.upToDate}</td>
                      <td className="py-2 px-3 text-slate-400">{dep.available}</td>
                      <td className="py-2 px-3 text-slate-500">{dep.age}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {!k8sData.deployments.length && <div className="py-12 text-center text-slate-600 text-sm">{t('kubernetes.noDeployments')}</div>}
          </div>
        </Card>
      )}

      {activeTab === 'events' && (
        <Card padding="none">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#1e1e2e]">
                  {[t('common.type'), t('common.namespace'), 'Object', 'Reason', 'Message', 'Count', 'Last Time'].map((h) => (
                    <th key={h} className="text-left py-2 px-3 text-slate-500 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {k8sData.events.map((ev, i) => (
                  <tr key={i} className={`border-b border-[#1e1e2e]/50 transition-colors ${ev.type === 'Warning' ? 'bg-red-500/5 hover:bg-red-500/10' : 'hover:bg-[#1a1a25]'}`}>
                    <td className="py-2 px-3">
                      {ev.type === 'Warning' ? (
                        <Badge variant="danger"><AlertTriangle size={10} className="inline mr-0.5" />{ev.type}</Badge>
                      ) : (
                        <Badge variant="info">{ev.type}</Badge>
                      )}
                    </td>
                    <td className="py-2 px-3 text-slate-500">{ev.namespace}</td>
                    <td className="py-2 px-3 text-slate-300">{ev.name}</td>
                    <td className="py-2 px-3 text-slate-400">{ev.reason}</td>
                    <td className="py-2 px-3 text-slate-500 max-w-[240px] truncate">{ev.message}</td>
                    <td className="py-2 px-3 text-slate-400">{ev.count}</td>
                    <td className="py-2 px-3 text-slate-500">{ev.lastTimestamp ? new Date(ev.lastTimestamp).toLocaleTimeString('tr-TR') : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!k8sData.events.length && <div className="py-12 text-center text-slate-600 text-sm">{t('kubernetes.noEvents')}</div>}
          </div>
        </Card>
      )}
    </div>
  )
}
