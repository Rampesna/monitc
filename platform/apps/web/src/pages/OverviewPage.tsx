import { useEffect, useState } from 'react'
import { Activity, ArrowRight, Boxes, CircleCheck, Plus, Server, ShieldCheck, WifiOff } from 'lucide-react'
import type { ServerSummary, SystemMetricPoint } from '@monitc/shared'
import { Link } from 'react-router'
import { api, apiCached } from '../lib/api'
import { rate, timeAgo } from '../lib/format'
import { AddServerModal } from '../components/AddServerModal'
import { PageSkeleton } from '../components/Skeleton'
import { MetricChart } from '../components/MetricChart'
import { useAuth } from '../context'

export function OverviewPage() {
  const { user, workspace } = useAuth()
  const [loading, setLoading] = useState(true)
  const [servers, setServers] = useState<ServerSummary[]>([])
  const [points, setPoints] = useState<SystemMetricPoint[]>([])
  const [chartServerId, setChartServerId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const load = async () => {
    const [serverData, metricData] = await Promise.all([
      apiCached<{ servers: ServerSummary[] }>('/api/v1/servers', 8_000),
      api<{ serverId: string | null; points: SystemMetricPoint[] }>('/api/v1/metrics/servers/overview?hours=1')
    ])
    setServers(serverData.servers)
    setChartServerId(metricData.serverId)
    setPoints(metricData.points)
  }

  useEffect(() => {
    load().finally(() => setLoading(false))
    const timer = window.setInterval(() => void load(), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const connected = servers.filter((server) => server.status === 'connected').length
  const degraded = servers.filter((server) => server.status === 'degraded' || server.status === 'offline').length
  const latest = points.at(-1)
  if (loading) return <PageSkeleton />
  const chartServer = servers.find((server) => server.id === chartServerId)

  return (
    <div className="page overview-page">
      <div className="page-title">
        <div><p className="eyebrow">INFRASTRUCTURE</p><h1>Good {greeting()}, {user?.displayName.split(' ')[0]}.</h1><p>Here is what your systems are doing right now.</p></div>
        <button className="primary-button" onClick={() => setAddOpen(true)}><Plus size={15} /> Add server</button>
      </div>

      <div className="stat-grid">
        <article className="stat-card"><span className="stat-icon purple"><Server size={17} /></span><div><p>Connected servers</p><strong>{connected}<small> / {servers.length}</small></strong></div><span className="trend positive"><CircleCheck size={12} /> live</span></article>
        <article className="stat-card"><span className="stat-icon cyan"><Activity size={17} /></span><div><p>Current CPU</p><strong>{latest ? `${latest.cpuPercent.toFixed(0)}%` : '—'}</strong></div><span className="trend">latest sample</span></article>
        <article className="stat-card"><span className="stat-icon green"><Boxes size={17} /></span><div><p>Metric retention</p><strong>{workspace?.plan.entitlements.retentionDays}<small> days</small></strong></div><span className="trend">{workspace?.plan.name}</span></article>
        <article className="stat-card"><span className={`stat-icon ${degraded ? 'red' : 'green'}`}>{degraded ? <WifiOff size={17} /> : <ShieldCheck size={17} />}</span><div><p>Needs attention</p><strong>{degraded}</strong></div><span className={`trend ${degraded ? 'negative' : 'positive'}`}>{degraded ? 'review' : 'all clear'}</span></article>
      </div>

      <div className="overview-grid">
        <section className="panel activity-panel">
          <header className="panel-header"><div><h2>Resource activity</h2><p>{chartServer?.name || 'No server selected'} · last 60 minutes</p></div><span className="live-pill"><i /> Live</span></header>
          {points.length ? (
            <div className="main-chart">
              <MetricChart points={points} />
            </div>
          ) : (
            <div className="empty-chart"><Activity size={24} /><h3>Waiting for the first metric sample</h3><p>The collector will populate this view after a server is connected.</p></div>
          )}
          <footer className="chart-legend"><span><i className="purple" /> CPU</span><span><i className="cyan" /> Memory</span><span className="chart-network">Network {latest ? `${rate(latest.networkRxBytesPerSecond)} ↓ · ${rate(latest.networkTxBytesPerSecond)} ↑` : '—'}</span></footer>
        </section>

        <section className="panel server-list-panel">
          <header className="panel-header"><div><h2>Servers</h2><p>{servers.length} in this workspace</p></div><Link className="text-button" to="/servers">View all <ArrowRight size={13} /></Link></header>
          <div className="compact-server-list">
            {servers.slice(0, 6).map((server) => (
              <Link to={`/servers/${server.id}`} key={server.id} className="compact-server">
                <span className={`server-state ${server.status}`}><Server size={15} /></span>
                <span><strong>{server.name}</strong><small>{server.username ? `${server.username}@${server.host}` : 'Encrypted connection'}</small></span>
                <span className="server-seen"><i className={server.status} />{timeAgo(server.lastSeenAt)}</span>
              </Link>
            ))}
            {!servers.length && <div className="small-empty"><Server size={22} /><h3>No servers yet</h3><p>Add your first connection to begin.</p><button className="secondary-button" onClick={() => setAddOpen(true)}>Add server</button></div>}
          </div>
        </section>
      </div>

      <section className="plan-strip">
        <span className="plan-symbol"><ShieldCheck size={18} /></span>
        <div><strong>{workspace?.plan.name} workspace</strong><p>{servers.length} of {workspace?.plan.entitlements.servers ?? 'unlimited'} server slots in use · {workspace?.plan.entitlements.retentionDays}-day history</p></div>
        <Link to="/billing">Explore plans <ArrowRight size={13} /></Link>
      </section>

      <AddServerModal open={addOpen} onClose={() => setAddOpen(false)} onCreated={(server) => setServers((current) => [server, ...current])} />
    </div>
  )
}

function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'morning'
  if (hour < 18) return 'afternoon'
  return 'evening'
}
