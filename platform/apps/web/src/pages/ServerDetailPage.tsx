import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  ArrowLeft,
  Boxes,
  Cpu,
  FileCode2,
  Gauge,
  HardDrive,
  MemoryStick,
  Network,
  RadioTower,
  RefreshCw,
  Server,
  ShieldCheck,
  TerminalSquare
} from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { AgentTelemetryLatest, DockerContainerMetric, PodResourceMetric, ServerSummary, SystemMetricPoint } from '@monitc/shared'
import { Link, useParams, useSearchParams } from 'react-router'
import { api } from '../lib/api'
import { bytes, millicores, rate, timeAgo } from '../lib/format'
import { PageSkeleton } from '../components/Skeleton'
import { WebTerminal } from '../components/WebTerminal'
import { SftpBrowser } from '../components/SftpBrowser'

type Tab = 'overview' | 'kubernetes' | 'terminal' | 'files'

export function ServerDetailPage() {
  const { serverId = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const [server, setServer] = useState<ServerSummary | null>(null)
  const [points, setPoints] = useState<SystemMetricPoint[]>([])
  const [liveSample, setLiveSample] = useState<AgentTelemetryLatest | null>(null)
  const [pods, setPods] = useState<PodResourceMetric[]>([])
  const [containers, setContainers] = useState<DockerContainerMetric[]>([])
  const initialTab = searchParams.get('tab')
  const [tab, setTabState] = useState<Tab>(
    initialTab === 'kubernetes' || initialTab === 'terminal' || initialTab === 'files'
      ? initialTab
      : 'overview'
  )
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const setTab = (nextTab: Tab) => {
    setTabState(nextTab)
    setSearchParams(nextTab === 'overview' ? {} : { tab: nextTab }, { replace: true })
  }
  useEffect(() => {
    const requested = searchParams.get('tab')
    setTabState(
      requested === 'kubernetes' || requested === 'terminal' || requested === 'files'
        ? requested
        : 'overview'
    )
  }, [searchParams])

  const load = async () => {
    const servers = await api<{ servers: ServerSummary[] }>('/api/v1/servers')
    setServer(servers.servers.find((item) => item.id === serverId) || null)
    const [history, podData, containerData, latestData] = await Promise.all([
      api<{ points: SystemMetricPoint[] }>(`/api/v1/metrics/servers/${serverId}/history?hours=6`).catch(() => ({ points: [] })),
      api<{ pods: PodResourceMetric[] }>(`/api/v1/metrics/servers/${serverId}/pods`).catch(() => ({ pods: [] })),
      api<{ containers: DockerContainerMetric[] }>(`/api/v1/metrics/servers/${serverId}/containers`).catch(() => ({ containers: [] })),
      api<AgentTelemetryLatest>(`/api/v1/metrics/servers/${serverId}/latest`).catch(() => null)
    ])
    setPoints(history.points)
    setPods(podData.pods)
    setContainers(containerData.containers)
    setLiveSample(latestData)
  }
  useEffect(() => {
    load().finally(() => setLoading(false))
    const timer = window.setInterval(() => void load(), 5_000)
    return () => window.clearInterval(timer)
  }, [serverId])
  useEffect(() => {
    if (server && !server.sshFallbackConfigured && (tab === 'terminal' || tab === 'files')) {
      setTabState('overview')
      setSearchParams({}, { replace: true })
    }
  }, [server, tab, setSearchParams])

  const refresh = async () => {
    setRefreshing(true)
    await api(`/api/v1/servers/${serverId}/test`, { method: 'POST' }).catch(() => undefined)
    await load().finally(() => setRefreshing(false))
  }
  const latest = liveSample || points.at(-1)
  const chart = useMemo(() => points.map((point) => ({
    ...point,
    time: new Date(point.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  })), [points])
  if (loading) return <PageSkeleton />
  if (!server) return <div className="page-empty full"><Server size={28} /><h2>Server not found</h2><Link to="/servers">Back to servers</Link></div>

  const tabs: Array<{ id: Tab; label: string; icon: typeof Gauge }> = [
    { id: 'overview', label: 'Overview', icon: Gauge },
    { id: 'kubernetes', label: 'Kubernetes', icon: Boxes },
    { id: 'terminal', label: 'Terminal', icon: TerminalSquare },
    { id: 'files', label: 'Files', icon: FileCode2 }
  ]

  return (
    <div className={`page server-detail-page tab-${tab}`}>
      <div className="server-detail-heading">
        <Link className="back-link" to="/servers"><ArrowLeft size={14} /> Servers</Link>
        <div className="server-identity">
          <span className={`server-card-icon ${server.status}`}><Server size={20} /></span>
          <div><p className="eyebrow">SERVER WORKSPACE</p><h1>{server.name}</h1><span>{server.connectionMode === 'agent' ? `native agent${server.agent?.version ? ` ${server.agent.version}` : ''}` : `${server.username}@${server.host}:${server.port}`} · <i className={server.status} /> {server.status}</span></div>
        </div>
        <div className="server-heading-actions"><span>Last sample {timeAgo(server.lastSeenAt)}</span><button className="secondary-button" onClick={() => void refresh()}><RefreshCw size={14} className={refreshing ? 'spin' : ''} /> {server.connectionMode === 'agent' ? 'Refresh view' : 'Collect now'}</button></div>
      </div>
      <div className="tabs">
        {tabs.map(({ id, label, icon: Icon }) => {
          const needsSSH = id === 'terminal' || id === 'files'
          const disabled = needsSSH && !server.sshFallbackConfigured
          return <button key={id} disabled={disabled} title={disabled ? 'Add an encrypted SSH fallback to use this feature.' : undefined} className={tab === id ? 'active' : ''} onClick={() => !disabled && setTab(id)}><Icon size={14} /> {label}{id === 'kubernetes' && <small>{pods.length}</small>}</button>
        })}
      </div>

      {tab === 'overview' && (
        <div className="detail-content">
          <div className="resource-cards">
            <ResourceCard icon={Cpu} label="CPU usage" value={latest?.cpuPercent} tone="purple" />
            <ResourceCard icon={MemoryStick} label="Memory usage" value={latest?.memoryPercent} tone="cyan" />
            <ResourceCard icon={HardDrive} label="Root disk" value={latest?.diskPercent} tone="green" />
            <article className="resource-card network-card"><span className="resource-icon"><Network size={16} /></span><div><p>Network throughput</p><strong>{latest ? rate(latest.networkRxBytesPerSecond) : '—'}</strong><small>↓ incoming</small></div><div><strong>{latest ? rate(latest.networkTxBytesPerSecond) : '—'}</strong><small>↑ outgoing</small></div></article>
          </div>
          {server.connectionMode === 'agent' && <section className="agent-live-strip">
            <div className="agent-live-title"><span><RadioTower size={16} /></span><div><strong>Native telemetry stream</strong><small>{server.agent ? `mTLS identity ${server.agent.status}` : 'Waiting for one-time pairing'}</small></div></div>
            <AgentDatum label="Sampling" value={liveSample?.sampleIntervalNanos ? formatNanos(liveSample.sampleIntervalNanos) : '—'} />
            <AgentDatum label="Collection" value={liveSample?.collectionDurationNanos ? formatNanos(liveSample.collectionDurationNanos) : '—'} />
            <AgentDatum label="eBPF" value={liveSample?.ebpfActive ? 'Active' : 'Fallback'} tone={liveSample?.ebpfActive ? 'green' : ''} />
            <AgentDatum label="Sched / window" value={liveSample ? liveSample.schedulerSwitches.toLocaleString() : '—'} />
            <AgentDatum label="TCP retransmits" value={liveSample ? liveSample.tcpRetransmits.toLocaleString() : '—'} />
          </section>}
          <section className="panel detail-chart-panel">
            <header className="panel-header"><div><h2>Resource history</h2><p>CPU and memory · last 6 hours</p></div><span className="live-pill"><i /> {server.connectionMode === 'agent' ? 'native stream' : '30s'}</span></header>
            <div className="detail-chart">
              {chart.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chart} margin={{ top: 16, right: 8, left: -24, bottom: 0 }}>
                    <defs><linearGradient id="detailCpu" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8b7cff" stopOpacity=".3" /><stop offset="1" stopColor="#8b7cff" stopOpacity="0" /></linearGradient></defs>
                    <CartesianGrid stroke="#22222d" vertical={false} />
                    <XAxis dataKey="time" stroke="#5b5b6d" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} minTickGap={42} />
                    <YAxis domain={[0, 100]} stroke="#5b5b6d" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
                    <Tooltip contentStyle={{ background: '#111119', border: '1px solid #2b2b39', borderRadius: 10, fontSize: 11 }} />
                    <Area type="monotone" dataKey="cpuPercent" stroke="#8b7cff" strokeWidth={2} fill="url(#detailCpu)" />
                    <Area type="monotone" dataKey="memoryPercent" stroke="#48d5e5" strokeWidth={2} fill="transparent" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : <div className="empty-chart"><Activity size={22} /><p>Waiting for metric history.</p></div>}
            </div>
          </section>
          <div className="detail-lower-grid">
            <section className="panel"><header className="panel-header"><div><h2>Docker snapshot</h2><p>Live container resource telemetry</p></div><Link className="text-button" to="/workloads">View fleet</Link></header><div className="pod-summary"><strong>{containers.length}</strong><span>containers discovered</span><div><b>{containers.filter((container) => container.state === 'running').length}</b> running</div><div><b>{containers.reduce((sum, container) => sum + container.cpuPercent, 0).toFixed(1)}%</b> CPU</div></div></section>
            <section className="panel"><header className="panel-header"><div><h2>Kubernetes snapshot</h2><p>Assigned resources and live utilization</p></div><button className="text-button" onClick={() => setTab('kubernetes')}>View pods</button></header><div className="pod-summary"><strong>{pods.length}</strong><span>pods discovered</span><div><b>{pods.filter((pod) => pod.phase === 'Running').length}</b> running</div><div><b>{pods.filter((pod) => pod.restarts > 0).length}</b> restarted</div></div></section>
            {server.sshFallbackConfigured ? <section className="panel connection-panel"><header className="panel-header"><div><h2>Secure access</h2><p>Open an isolated browser session over SSH fallback</p></div></header><div><button onClick={() => setTab('terminal')}><TerminalSquare size={17} /><span><strong>Web terminal</strong><small>One-time session ticket</small></span></button><button onClick={() => setTab('files')}><FileCode2 size={17} /><span><strong>SFTP files</strong><small>Browse, edit and transfer</small></span></button></div></section> : <section className="panel agent-identity-panel"><header className="panel-header"><div><h2>Agent identity</h2><p>Credential-free outbound access</p></div><ShieldCheck size={15} /></header><div>{server.agent ? <><span><strong>{server.agent.operatingSystem} / {server.agent.architecture}</strong><small>Kernel {server.agent.kernelVersion || 'unknown'}</small></span><span><strong>Certificate rotation</strong><small>{new Date(server.agent.certificateExpiresAt).toLocaleString()}</small></span><span><strong>Offline buffer</strong><small>{bytes(server.agent.spoolBytes)} · {server.agent.spoolBatches} batches</small></span></> : <><RadioTower size={20} /><span><strong>Pairing required</strong><small>Open Servers and choose “Pair native agent”.</small></span></>}</div></section>}
          </div>
        </div>
      )}

      {tab === 'kubernetes' && <KubernetesTable pods={pods} />}
      {tab === 'terminal' && <WebTerminal serverId={serverId} />}
      {tab === 'files' && <SftpBrowser serverId={serverId} />}
    </div>
  )
}

function AgentDatum({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return <div className={`agent-live-datum ${tone}`}><span>{label}</span><strong>{value}</strong></div>
}

function formatNanos(value: number): string {
  if (value < 1_000) return `${Math.round(value)} ns`
  if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)} µs`
  if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(1)} ms`
  return `${(value / 1_000_000_000).toFixed(2)} s`
}

function ResourceCard({ icon: Icon, label, value, tone }: { icon: typeof Cpu; label: string; value?: number; tone: string }) {
  const normalized = Math.max(0, Math.min(100, value || 0))
  return (
    <article className="resource-card"><span className={`resource-icon ${tone}`}><Icon size={16} /></span><div><p>{label}</p><strong>{value === undefined ? '—' : `${value.toFixed(1)}%`}</strong><small>{value === undefined ? 'waiting for sample' : normalized > 85 ? 'high utilization' : 'within range'}</small></div><span className={`mini-gauge ${tone}`} style={{ '--gauge': `${normalized * 3.6}deg` } as React.CSSProperties}><i /></span></article>
  )
}

function KubernetesTable({ pods }: { pods: PodResourceMetric[] }) {
  const [query, setQuery] = useState('')
  const [namespace, setNamespace] = useState('all')
  const namespaces = [...new Set(pods.map((pod) => pod.namespace))].sort()
  const visible = pods.filter((pod) =>
    (namespace === 'all' || pod.namespace === namespace) &&
    `${pod.namespace} ${pod.name}`.toLowerCase().includes(query.toLowerCase())
  )
  return (
    <section className="kubernetes-workspace">
      <div className="k8s-summary">
        <article><span><Boxes size={16} /></span><div><p>Pods</p><strong>{pods.length}</strong></div></article>
        <article><span><Cpu size={16} /></span><div><p>CPU in use</p><strong>{millicores(pods.reduce((sum, pod) => sum + pod.cpuUsageMillicores, 0))}</strong></div></article>
        <article><span><MemoryStick size={16} /></span><div><p>Memory in use</p><strong>{bytes(pods.reduce((sum, pod) => sum + pod.memoryUsageBytes, 0))}</strong></div></article>
        <article><span><Network size={16} /></span><div><p>Pod traffic</p><strong>{rate(pods.reduce((sum, pod) => sum + pod.networkRxBytesPerSecond + pod.networkTxBytesPerSecond, 0))}</strong></div></article>
      </div>
      <div className="k8s-toolbar"><div className="search-field"><input placeholder="Search namespace or pod…" value={query} onChange={(event) => setQuery(event.target.value)} /></div><select value={namespace} onChange={(event) => setNamespace(event.target.value)}><option value="all">All namespaces</option>{namespaces.map((value) => <option key={value}>{value}</option>)}</select></div>
      <div className="data-panel">
        <table className="data-table pod-table">
          <thead><tr><th>Workload</th><th>Status</th><th>CPU current / assigned</th><th>CPU use</th><th>Memory current / assigned</th><th>Memory use</th><th>Traffic ↓ / ↑</th></tr></thead>
          <tbody>
            {visible.map((pod) => {
              const cpuAssigned = pod.cpuLimitMillicores || pod.cpuRequestMillicores
              const memoryAssigned = pod.memoryLimitBytes || pod.memoryRequestBytes
              return (
                <tr key={`${pod.namespace}/${pod.name}`}>
                  <td><span className="pod-icon"><Boxes size={15} /></span><span><strong>{pod.name}</strong><small>{pod.namespace} · {pod.node}</small></span></td>
                  <td><span className={`status-badge ${pod.phase.toLowerCase()}`}><i /> {pod.phase}</span><small className="ready-value">{pod.ready} ready · {pod.restarts} restarts</small></td>
                  <td><strong>{millicores(pod.cpuUsageMillicores)}</strong><small>/ {cpuAssigned ? millicores(cpuAssigned) : 'not assigned'}</small></td>
                  <td><UsageBar value={pod.cpuUsagePercent} /></td>
                  <td><strong>{bytes(pod.memoryUsageBytes)}</strong><small>/ {memoryAssigned ? bytes(memoryAssigned) : 'not assigned'}</small></td>
                  <td><UsageBar value={pod.memoryUsagePercent} /></td>
                  <td><span className="traffic-value">{rate(pod.networkRxBytesPerSecond)} ↓</span><small>{rate(pod.networkTxBytesPerSecond)} ↑</small></td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!visible.length && <div className="small-empty"><Boxes size={22} /><h3>No pod resource samples yet</h3><p>metrics-server and kubelet summary data will appear after collection.</p></div>}
      </div>
    </section>
  )
}

function UsageBar({ value }: { value: number | null }) {
  if (value === null) return <span className="unassigned">No request/limit</span>
  const bounded = Math.max(0, Math.min(100, value))
  return <div className={`usage-cell ${bounded > 90 ? 'critical' : bounded > 75 ? 'warning' : ''}`}><span><i style={{ width: `${bounded}%` }} /></span><strong>{value.toFixed(1)}%</strong></div>
}
