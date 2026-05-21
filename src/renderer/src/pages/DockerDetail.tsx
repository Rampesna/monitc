import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Container, ScrollText } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Card } from '../components/common/Card'
import { Button } from '../components/common/Button'
import { Badge } from '../components/common/Badge'
import { LogTerminal } from '../components/terminal/LogTerminal'
import { AreaChart } from '../components/charts/AreaChart'

export function DockerDetail(): React.ReactElement {
  const { serverId, containerId } = useParams<{ serverId: string; containerId: string }>()
  const { state } = useApp()
  const navigate = useNavigate()
  const [inspect, setInspect] = useState<Record<string, unknown> | null>(null)
  const [streamId, setStreamId] = useState<string | null>(null)
  const [statsHistory, setStatsHistory] = useState<{ t: string; cpu: number; mem: number }[]>([])

  const sid = serverId ?? state.selectedServerId ?? ''
  const dockerData = state.dockerData[sid]
  const container = dockerData?.containers.find((c) => c.id === containerId)

  useEffect(() => {
    if (!sid || !containerId) return
    window.monitcAPI.docker.inspect(sid, containerId).then((data) => {
      setInspect(data as Record<string, unknown>)
    }).catch(console.error)

    window.monitcAPI.logs.startDocker(sid, containerId, 500).then((id) => {
      setStreamId(id)
    }).catch(console.error)

    return () => {
      if (streamId) window.monitcAPI.logs.stop(streamId).catch(console.error)
    }
  }, [sid, containerId])

  useEffect(() => {
    if (!container) return
    const now = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    setStatsHistory((h) => [...h.slice(-60), { t: now, cpu: container.cpuPercent ?? 0, mem: container.memPercent ?? 0 }])
  }, [container?.cpuPercent, container?.memPercent])

  const inspectData = inspect?.[0] as Record<string, unknown> | undefined

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" icon={<ArrowLeft size={14} />} onClick={() => navigate(-1)}>Geri</Button>
        <Container size={16} className="text-blue-400" />
        <h1 className="text-sm font-semibold text-slate-100">{container?.names.replace(/^\//, '') ?? containerId}</h1>
        {container && <Badge variant={container.state === 'running' ? 'success' : 'danger'}>{container.state}</Badge>}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card>
          <h2 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">
            <ScrollText size={14} className="text-indigo-400" /> Container Bilgileri
          </h2>
          {inspectData ? (
            <div className="space-y-2 text-xs">
              {[
                ['Image', container?.image],
                ['Durum', container?.status],
                ['Portlar', container?.ports || '-'],
                ['Oluşturulma', String((inspectData.Created as string | undefined) ?? '-')],
                ['IP Adresi', String(((inspectData.NetworkSettings as Record<string, unknown>)?.IPAddress as string | undefined) ?? '-')]
              ].map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <span className="text-slate-500 w-24 flex-shrink-0">{k}:</span>
                  <span className="text-slate-200 break-all">{v}</span>
                </div>
              ))}
              {((inspectData.Config as Record<string, unknown>)?.Env as string[] | undefined)?.slice(0, 5).map((e) => (
                <div key={e} className="font-mono text-slate-500 text-[10px] break-all">{e}</div>
              ))}
            </div>
          ) : (
            <p className="text-slate-600 text-xs">Yükleniyor...</p>
          )}
        </Card>

        <Card>
          <h2 className="text-sm font-semibold text-slate-200 mb-3">CPU & Bellek</h2>
          <AreaChart
            data={statsHistory.map((s) => ({ ...s, timestamp: s.t }))}
            series={[
              { key: 'cpu', label: 'CPU %', color: '#6366f1' },
              { key: 'mem', label: 'Bellek %', color: '#22c55e' }
            ]}
            xKey="timestamp"
            yDomain={[0, 100]}
            yFormatter={(v) => `${v}%`}
            height={160}
          />
        </Card>
      </div>

      <Card className="flex flex-col" style={{ height: 400 }}>
        <h2 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">
          <ScrollText size={14} className="text-green-400" /> Canlı Loglar
        </h2>
        <div className="flex-1 overflow-hidden rounded-lg bg-[#0a0a0f]">
          <LogTerminal streamId={streamId} className="h-full" />
        </div>
      </Card>
    </div>
  )
}
