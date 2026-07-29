import { useEffect, useState } from 'react'
import { Activity, Building2, Database, Mail, Server, Users } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../lib/api'
import { PageLoader, Stat } from '../components/Shell'

interface Overview {
  users: number
  workspaces: number
  servers: number
  active_subscriptions: number
  pendingRequests: number
  metricSamples24h: number
  serverStates: Record<string, number>
  recentSignups: Array<{ day: string; count: number }>
}

export function OverviewPage() {
  const [data, setData] = useState<Overview | null>(null)
  useEffect(() => { void api<Overview>('/api/v1/admin/overview').then(setData) }, [])
  if (!data) return <PageLoader />
  const connected = data.serverStates.connected || 0
  const health = data.servers ? Math.round((connected / data.servers) * 100) : 100
  return (
    <div className="ops-page">
      <header className="ops-page-title"><div><p>CONTROL PLANE</p><h1>Good morning, Talha.</h1><span>Platform posture and commercial operations in one view.</span></div><span className="last-updated"><i /> Live data</span></header>
      <section className="ops-stat-grid">
        <Stat icon={Users} label="Users" value={data.users} note="Active accounts" />
        <Stat icon={Building2} label="Workspaces" value={data.workspaces} note={`${data.active_subscriptions} active subscriptions`} tone="cyan" />
        <Stat icon={Server} label="Managed servers" value={data.servers} note={`${connected} connected`} tone="green" />
        <Stat icon={Mail} label="Open requests" value={data.pendingRequests} note="Need manual follow-up" tone={data.pendingRequests ? 'orange' : 'green'} />
      </section>
      <div className="ops-overview-grid">
        <section className="ops-panel signups-panel">
          <header><div><h2>Workspace growth</h2><p>New user registrations · 14 days</p></div><span>Daily</span></header>
          <div className="ops-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data.recentSignups}><defs><linearGradient id="signupFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#806df3" stopOpacity=".32" /><stop offset="1" stopColor="#806df3" stopOpacity="0" /></linearGradient></defs><CartesianGrid stroke="#22212b" vertical={false} /><XAxis dataKey="day" tickFormatter={(value) => value.slice(5)} tick={{ fontSize: 9 }} stroke="#514e59" tickLine={false} axisLine={false} /><YAxis allowDecimals={false} tick={{ fontSize: 9 }} stroke="#514e59" tickLine={false} axisLine={false} /><Tooltip contentStyle={{ background: '#111118', border: '1px solid #2a2935', borderRadius: 9, fontSize: 10 }} /><Area type="monotone" dataKey="count" stroke="#8875f5" strokeWidth={2} fill="url(#signupFill)" /></AreaChart></ResponsiveContainer></div>
        </section>
        <section className="ops-panel posture-panel">
          <header><div><h2>Service posture</h2><p>Current managed target state</p></div><Activity size={15} /></header>
          <div className="health-ring" style={{ '--health': `${health * 3.6}deg` } as React.CSSProperties}><span><strong>{health}%</strong><small>connected</small></span></div>
          <div className="posture-legend"><span><i className="green" /> Connected <b>{connected}</b></span><span><i className="orange" /> Degraded <b>{data.serverStates.degraded || 0}</b></span><span><i className="red" /> Offline <b>{data.serverStates.offline || 0}</b></span></div>
        </section>
      </div>
      <section className="ops-panel system-strip"><div><span><Database size={16} /></span><p>Metric ingestion</p><strong>{data.metricSamples24h.toLocaleString()}</strong><small>samples / 24h</small></div><div><span><Activity size={16} /></span><p>API</p><strong>Healthy</strong><small>ready probe passing</small></div><div><span><Server size={16} /></span><p>Collectors</p><strong>{data.servers}</strong><small>registered targets</small></div></section>
    </div>
  )
}
