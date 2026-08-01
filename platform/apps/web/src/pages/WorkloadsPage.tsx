import { useCallback, useEffect, useMemo, useState } from 'react'
import { Box, Boxes, MemoryStick, Network, RefreshCw, Search, ShieldCheck } from 'lucide-react'
import { api } from '../lib/api'
import { bytes, millicores, rate } from '../lib/format'
import { PageSkeleton } from '../components/Skeleton'
import {
  WorkloadDrawer,
  type FleetContainer,
  type FleetPod,
  type SelectedWorkload
} from '../components/WorkloadDrawer'
import { useAuth } from '../context'

interface FleetResponse {
  pods: FleetPod[]
  containers: FleetContainer[]
}

export function WorkloadsPage() {
  const { workspace } = useAuth()
  const [rows, setRows] = useState<FleetPod[]>([])
  const [containers, setContainers] = useState<FleetContainer[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [selected, setSelected] = useState<SelectedWorkload | null>(null)

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true)
    try {
      const data = await api<FleetResponse>('/api/v1/metrics/servers/fleet')
      setRows(data.pods)
      setContainers(data.containers)
    } finally {
      setLoading(false)
      if (!quiet) setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load(true)
    const timer = window.setInterval(() => void load(true), 15_000)
    return () => window.clearInterval(timer)
  }, [load])

  const normalizedQuery = query.trim().toLowerCase()
  const visibleContainers = useMemo(() => containers.filter((container) =>
    (status === 'all' || container.state.toLowerCase() === status) &&
    (!normalizedQuery || `${container.name} ${container.image} ${container.serverName}`.toLowerCase().includes(normalizedQuery))
  ), [containers, normalizedQuery, status])
  const visiblePods = useMemo(() => rows.filter((pod) =>
    (status === 'all' || pod.phase.toLowerCase() === status) &&
    (!normalizedQuery || `${pod.name} ${pod.namespace} ${pod.serverName} ${pod.node}`.toLowerCase().includes(normalizedQuery))
  ), [rows, normalizedQuery, status])

  if (loading) return <PageSkeleton />

  return (
    <div className="page workloads-page">
      <div className="page-title">
        <div><p className="eyebrow">WORKLOAD FLEET</p><h1>Workloads</h1><p>Inspect live resource use, open logs and safely operate containers and pods.</p></div>
        <button className="secondary-button" onClick={() => void load()}><RefreshCw size={14} className={refreshing ? 'spin' : ''} /> Refresh</button>
      </div>
      <div className="stat-grid">
        <article className="stat-card"><span className="stat-icon purple"><Boxes size={17} /></span><div><p>Pods</p><strong>{rows.length}</strong></div></article>
        <article className="stat-card"><span className="stat-icon cyan"><Box size={17} /></span><div><p>Containers</p><strong>{containers.length}</strong></div></article>
        <article className="stat-card"><span className="stat-icon green"><MemoryStick size={17} /></span><div><p>Pod memory</p><strong>{bytes(rows.reduce((sum, row) => sum + row.memoryUsageBytes, 0))}</strong></div></article>
        <article className="stat-card"><span className="stat-icon blue"><Network size={17} /></span><div><p>Pod traffic</p><strong>{rate(rows.reduce((sum, row) => sum + row.networkRxBytesPerSecond + row.networkTxBytesPerSecond, 0))}</strong></div></article>
      </div>

      <div className="fleet-toolbar">
        <label><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search workloads, images, namespaces or servers…" /></label>
        <div className="fleet-filters">
          {['all', 'running', 'pending', 'exited', 'failed'].map((value) => <button key={value} className={status === value ? 'active' : ''} onClick={() => setStatus(value)}>{value}</button>)}
        </div>
        <span className="fleet-capability"><ShieldCheck size={13} /> {workspace?.plan.entitlements.workloadActions ? 'Operate enabled' : workspace?.plan.entitlements.workloadLogs ? 'Inspect enabled' : 'Metrics only'}</span>
      </div>

      <div className="workload-section-heading"><div><span><Box size={15} /></span><div><h2>Docker containers</h2><p>Click a container to inspect it and open its remote logs</p></div></div><small>{visibleContainers.length} shown</small></div>
      <div className="data-panel workload-click-panel">
        <table className="data-table container-table">
          <thead><tr><th>Container</th><th>Server / image</th><th>Status</th><th>CPU</th><th>Memory</th><th>Traffic</th><th /></tr></thead>
          <tbody>{visibleContainers.map((container) => (
            <tr key={`${container.serverId}/${container.id}`} tabIndex={0} onClick={() => setSelected({ type: 'docker', item: container })} onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && setSelected({ type: 'docker', item: container })}>
              <td><span className="pod-icon"><Box size={15} /></span><strong>{container.name}</strong></td>
              <td><strong>{container.serverName}</strong><small>{container.image}</small></td>
              <td><span className={`status-badge ${container.state.toLowerCase()}`}><i />{container.state}</span><small>{container.status}</small></td>
              <td><strong>{container.cpuPercent.toFixed(1)}%</strong><small>host CPU</small></td>
              <td><strong>{bytes(container.memoryUsageBytes)}</strong><small>{container.memoryUsagePercent === null ? 'no limit' : `${container.memoryUsagePercent.toFixed(1)}% of limit`}</small></td>
              <td><strong>{rate(container.networkRxBytesPerSecond)} ↓</strong><small>{rate(container.networkTxBytesPerSecond)} ↑</small></td>
              <td><span className="row-open">Open</span></td>
            </tr>
          ))}</tbody>
        </table>
        {!visibleContainers.length && <div className="small-empty"><Box size={22} /><h3>No matching Docker workloads</h3><p>Clear the filters or wait for the native agent to report inventory.</p></div>}
      </div>

      <div className="workload-section-heading"><div><span><Boxes size={15} /></span><div><h2>Kubernetes pods</h2><p>Assigned resources, live utilization, describe output and logs</p></div></div><small>{visiblePods.length} shown</small></div>
      <div className="data-panel workload-click-panel">
        <table className="data-table pod-table fleet-table">
          <thead><tr><th>Pod</th><th>Server / namespace</th><th>Status</th><th>CPU</th><th>Memory</th><th>Traffic</th><th /></tr></thead>
          <tbody>{visiblePods.map((row) => (
            <tr key={`${row.serverId}/${row.namespace}/${row.name}`} tabIndex={0} onClick={() => setSelected({ type: 'kubernetes', item: row })} onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && setSelected({ type: 'kubernetes', item: row })}>
              <td><span className="pod-icon"><Boxes size={15} /></span><strong>{row.name}</strong></td>
              <td><strong>{row.serverName}</strong><small>{row.namespace} · {row.node}</small></td>
              <td><span className={`status-badge ${row.phase.toLowerCase()}`}><i />{row.phase}</span><small>{row.ready} ready · {row.restarts} restarts</small></td>
              <td><strong>{millicores(row.cpuUsageMillicores)}</strong><small>{row.cpuUsagePercent === null ? 'unassigned' : `${row.cpuUsagePercent.toFixed(1)}% assigned`}</small></td>
              <td><strong>{bytes(row.memoryUsageBytes)}</strong><small>{row.memoryUsagePercent === null ? 'unassigned' : `${row.memoryUsagePercent.toFixed(1)}% assigned`}</small></td>
              <td><strong>{rate(row.networkRxBytesPerSecond)} ↓</strong><small>{rate(row.networkTxBytesPerSecond)} ↑</small></td>
              <td><span className="row-open">Open</span></td>
            </tr>
          ))}</tbody>
        </table>
        {!visiblePods.length && <div className="small-empty"><Boxes size={22} /><h3>No matching Kubernetes workloads</h3><p>Clear the filters or connect a cluster with metrics-server enabled.</p></div>}
      </div>
      <WorkloadDrawer selected={selected} onClose={() => setSelected(null)} onChanged={() => void load(true)} />
    </div>
  )
}
