import { useEffect, useState } from 'react'
import { Boxes, Cpu, MemoryStick, Network } from 'lucide-react'
import type { PodResourceMetric, ServerSummary } from '@monitc/shared'
import { api } from '../lib/api'
import { bytes, millicores, rate } from '../lib/format'
import { PageSkeleton } from '../components/Skeleton'

interface Row extends PodResourceMetric { serverName: string }

export function WorkloadsPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    void api<{ servers: ServerSummary[] }>('/api/v1/servers').then(async ({ servers }) => {
      const data = await Promise.all(servers.map(async (server) => {
        const result = await api<{ pods: PodResourceMetric[] }>(`/api/v1/metrics/servers/${server.id}/pods`).catch(() => ({ pods: [] }))
        return result.pods.map((pod) => ({ ...pod, serverName: server.name }))
      }))
      setRows(data.flat())
    }).finally(() => setLoading(false))
  }, [])
  if (loading) return <PageSkeleton />

  return (
    <div className="page workloads-page">
      <div className="page-title"><div><p className="eyebrow">KUBERNETES FLEET</p><h1>Workloads</h1><p>Current resource allocation and use across every connected cluster.</p></div></div>
      <div className="stat-grid">
        <article className="stat-card"><span className="stat-icon purple"><Boxes size={17} /></span><div><p>Pods</p><strong>{rows.length}</strong></div></article>
        <article className="stat-card"><span className="stat-icon cyan"><Cpu size={17} /></span><div><p>CPU current</p><strong>{millicores(rows.reduce((sum, row) => sum + row.cpuUsageMillicores, 0))}</strong></div></article>
        <article className="stat-card"><span className="stat-icon green"><MemoryStick size={17} /></span><div><p>Memory current</p><strong>{bytes(rows.reduce((sum, row) => sum + row.memoryUsageBytes, 0))}</strong></div></article>
        <article className="stat-card"><span className="stat-icon blue"><Network size={17} /></span><div><p>Combined traffic</p><strong>{rate(rows.reduce((sum, row) => sum + row.networkRxBytesPerSecond + row.networkTxBytesPerSecond, 0))}</strong></div></article>
      </div>
      <div className="data-panel">
        <table className="data-table pod-table fleet-table">
          <thead><tr><th>Pod</th><th>Server / namespace</th><th>Status</th><th>CPU</th><th>Memory</th><th>Traffic</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={`${row.serverName}/${row.namespace}/${row.name}`}><td><span className="pod-icon"><Boxes size={15} /></span><strong>{row.name}</strong></td><td><strong>{row.serverName}</strong><small>{row.namespace}</small></td><td><span className={`status-badge ${row.phase.toLowerCase()}`}><i />{row.phase}</span></td><td><strong>{millicores(row.cpuUsageMillicores)}</strong><small>{row.cpuUsagePercent === null ? 'unassigned' : `${row.cpuUsagePercent.toFixed(1)}% assigned`}</small></td><td><strong>{bytes(row.memoryUsageBytes)}</strong><small>{row.memoryUsagePercent === null ? 'unassigned' : `${row.memoryUsagePercent.toFixed(1)}% assigned`}</small></td><td><strong>{rate(row.networkRxBytesPerSecond)} ↓</strong><small>{rate(row.networkTxBytesPerSecond)} ↑</small></td></tr>)}</tbody>
        </table>
        {!rows.length && <div className="small-empty"><Boxes size={22} /><h3>No Kubernetes samples yet</h3><p>Connect a cluster with metrics-server enabled.</p></div>}
      </div>
    </div>
  )
}
