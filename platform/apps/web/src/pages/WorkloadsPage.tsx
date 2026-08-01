import { useEffect, useState } from 'react'
import { Box, Boxes, MemoryStick, Network } from 'lucide-react'
import type { DockerContainerMetric, PodResourceMetric, ServerSummary } from '@monitc/shared'
import { api } from '../lib/api'
import { bytes, millicores, rate } from '../lib/format'
import { PageSkeleton } from '../components/Skeleton'

interface Row extends PodResourceMetric { serverName: string }
interface ContainerRow extends DockerContainerMetric { serverName: string }

export function WorkloadsPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [containers, setContainers] = useState<ContainerRow[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    void api<{ servers: ServerSummary[] }>('/api/v1/servers').then(async ({ servers }) => {
      const data = await Promise.all(servers.map(async (server) => {
        const [podResult, containerResult] = await Promise.all([
          api<{ pods: PodResourceMetric[] }>(`/api/v1/metrics/servers/${server.id}/pods`).catch(() => ({ pods: [] })),
          api<{ containers: DockerContainerMetric[] }>(`/api/v1/metrics/servers/${server.id}/containers`).catch(() => ({ containers: [] }))
        ])
        return {
          pods: podResult.pods.map((pod) => ({ ...pod, serverName: server.name })),
          containers: containerResult.containers.map((container) => ({ ...container, serverName: server.name }))
        }
      }))
      setRows(data.flatMap((item) => item.pods))
      setContainers(data.flatMap((item) => item.containers))
    }).finally(() => setLoading(false))
  }, [])
  if (loading) return <PageSkeleton />

  return (
    <div className="page workloads-page">
      <div className="page-title"><div><p className="eyebrow">WORKLOAD FLEET</p><h1>Workloads</h1><p>Current Docker and Kubernetes resource use across every connected server.</p></div></div>
      <div className="stat-grid">
        <article className="stat-card"><span className="stat-icon purple"><Boxes size={17} /></span><div><p>Pods</p><strong>{rows.length}</strong></div></article>
        <article className="stat-card"><span className="stat-icon cyan"><Box size={17} /></span><div><p>Containers</p><strong>{containers.length}</strong></div></article>
        <article className="stat-card"><span className="stat-icon green"><MemoryStick size={17} /></span><div><p>Pod memory</p><strong>{bytes(rows.reduce((sum, row) => sum + row.memoryUsageBytes, 0))}</strong></div></article>
        <article className="stat-card"><span className="stat-icon blue"><Network size={17} /></span><div><p>Pod traffic</p><strong>{rate(rows.reduce((sum, row) => sum + row.networkRxBytesPerSecond + row.networkTxBytesPerSecond, 0))}</strong></div></article>
      </div>
      <div className="workload-section-heading"><div><span><Box size={15} /></span><div><h2>Docker containers</h2><p>Latest agent inventory and live resource use</p></div></div><small>{containers.length} discovered</small></div>
      <div className="data-panel">
        <table className="data-table container-table">
          <thead><tr><th>Container</th><th>Server / image</th><th>Status</th><th>CPU</th><th>Memory</th><th>Traffic</th></tr></thead>
          <tbody>{containers.map((container) => <tr key={`${container.serverName}/${container.id}`}><td><span className="pod-icon"><Box size={15} /></span><strong>{container.name}</strong></td><td><strong>{container.serverName}</strong><small>{container.image}</small></td><td><span className={`status-badge ${container.state.toLowerCase()}`}><i />{container.state}</span><small>{container.status}</small></td><td><strong>{container.cpuPercent.toFixed(1)}%</strong><small>host CPU</small></td><td><strong>{bytes(container.memoryUsageBytes)}</strong><small>{container.memoryUsagePercent === null ? 'no limit' : `${container.memoryUsagePercent.toFixed(1)}% of limit`}</small></td><td><strong>{rate(container.networkRxBytesPerSecond)} ↓</strong><small>{rate(container.networkTxBytesPerSecond)} ↑</small></td></tr>)}</tbody>
        </table>
        {!containers.length && <div className="small-empty"><Box size={22} /><h3>No Docker samples yet</h3><p>The native agent will report containers when the Docker socket is available.</p></div>}
      </div>
      <div className="workload-section-heading"><div><span><Boxes size={15} /></span><div><h2>Kubernetes pods</h2><p>Assigned resources and current usage</p></div></div><small>{rows.length} discovered</small></div>
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
