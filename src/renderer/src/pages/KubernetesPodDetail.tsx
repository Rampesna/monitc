import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Box } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Card } from '../components/common/Card'
import { Badge } from '../components/common/Badge'
import { Button } from '../components/common/Button'
import { LogTerminal } from '../components/terminal/LogTerminal'
import { Tabs } from '../components/common/Tabs'

export function KubernetesPodDetail(): React.ReactElement {
  const { serverId, namespace, podName } = useParams<{ serverId: string; namespace: string; podName: string }>()
  const { state } = useApp()
  const navigate = useNavigate()
  const [describe, setDescribe] = useState('')
  const [selectedContainer, setSelectedContainer] = useState<string | undefined>(undefined)
  const [streamId, setStreamId] = useState<string | null>(null)

  const sid = serverId ?? state.selectedServerId ?? ''
  const k8sData = state.kubernetesData[sid]
  const pod = k8sData?.pods.find((p) => p.namespace === namespace && p.name === podName)

  useEffect(() => {
    if (!sid || !namespace || !podName) return
    window.monitcAPI.kubernetes.podDescribe(sid, namespace, podName).then(setDescribe).catch(console.error)
  }, [sid, namespace, podName])

  useEffect(() => {
    if (!sid || !namespace || !podName) return
    if (streamId) { window.monitcAPI.logs.stop(streamId).catch(console.error) }
    window.monitcAPI.logs.startK8s(sid, namespace, podName, selectedContainer).then((id) => {
      setStreamId(id)
    }).catch(console.error)
  }, [sid, namespace, podName, selectedContainer])

  const containers = pod?.containers ?? []
  const containerTabs = [
    { id: 'all', label: 'Tümü' },
    ...containers.map((c) => ({ id: c, label: c }))
  ]

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" icon={<ArrowLeft size={14} />} onClick={() => navigate(-1)}>Geri</Button>
        <Box size={16} className="text-purple-400" />
        <div>
          <span className="text-sm font-semibold text-slate-100">{podName}</span>
          <span className="text-xs text-slate-500 ml-2">{namespace}</span>
        </div>
        {pod && <Badge variant={pod.status === 'Running' ? 'success' : 'danger'}>{pod.status}</Badge>}
        {pod && pod.restarts > 0 && (
          <Badge variant={pod.restarts > 5 ? 'danger' : 'warning'}>{pod.restarts} yeniden başlatma</Badge>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card>
          <h2 className="text-sm font-semibold text-slate-200 mb-3">Pod Detayları</h2>
          {pod ? (
            <div className="space-y-1.5 text-xs">
              {[
                ['Durum', pod.status],
                ['Hazır', pod.ready],
                ['Yeniden Başlatma', String(pod.restarts)],
                ['Node', pod.node],
                ['IP', pod.ip],
                ['Yaş', pod.age],
                ['Container\'lar', pod.containers.join(', ')]
              ].map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <span className="text-slate-500 w-32 flex-shrink-0">{k}:</span>
                  <span className="text-slate-200">{v}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-600">Pod bilgisi yok.</p>
          )}
        </Card>

        <Card className="overflow-hidden">
          <h2 className="text-sm font-semibold text-slate-200 mb-3">describe Çıktısı</h2>
          <pre className="text-[10px] text-slate-400 overflow-auto max-h-48 font-mono whitespace-pre-wrap break-all">
            {describe || 'Yükleniyor...'}
          </pre>
        </Card>
      </div>

      <Card className="space-y-3 flex flex-col" style={{ height: 400 }}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-200">Canlı Loglar</h2>
          {containers.length > 1 && (
            <Tabs
              tabs={containerTabs}
              active={selectedContainer ?? 'all'}
              onChange={(id) => setSelectedContainer(id === 'all' ? undefined : id)}
            />
          )}
        </div>
        <div className="flex-1 overflow-hidden rounded-lg bg-[#0a0a0f]">
          <LogTerminal streamId={streamId} className="h-full" />
        </div>
      </Card>
    </div>
  )
}
