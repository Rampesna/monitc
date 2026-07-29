import { useEffect, useState } from 'react'
import { Building2, Search, Server, Users } from 'lucide-react'
import { PLANS, type PlanCode } from '@monitc/shared'
import { api, json } from '../lib/api'
import { PageLoader } from '../components/Shell'

interface Workspace {
  id: string
  name: string
  slug: string
  planCode: PlanCode
  memberCount: number
  serverCount: number
  ownerEmail: string
  createdAt: string
}

export function WorkspacesPage() {
  const [items, setItems] = useState<Workspace[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const load = async () => {
    const data = await api<{ workspaces: Workspace[] }>(`/api/v1/admin/workspaces?q=${encodeURIComponent(query)}`)
    setItems(data.workspaces)
  }
  useEffect(() => { const timer = window.setTimeout(() => void load().finally(() => setLoading(false)), 180); return () => window.clearTimeout(timer) }, [query])
  const changePlan = async (workspace: Workspace, planCode: PlanCode) => {
    if (workspace.planCode === planCode) return
    if (!window.confirm(`Assign ${planCode} to ${workspace.name}?`)) return
    await api(`/api/v1/admin/workspaces/${workspace.id}/plan`, { method: 'PATCH', ...json({ planCode }) })
    setItems((current) => current.map((item) => item.id === workspace.id ? { ...item, planCode } : item))
  }
  if (loading) return <PageLoader />
  return (
    <div className="ops-page">
      <header className="ops-page-title"><div><p>CUSTOMERS</p><h1>Workspaces</h1><span>Entitlements, utilization and manual plan control.</span></div></header>
      <div className="ops-table-toolbar"><div><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search workspaces…" /></div><span>{items.length} workspaces</span></div>
      <section className="ops-table-panel">
        <table><thead><tr><th>Workspace</th><th>Owner</th><th>Usage</th><th>Plan</th><th>Created</th></tr></thead><tbody>{items.map((workspace) => <tr key={workspace.id}><td><span className="table-avatar"><Building2 size={14} /></span><div><strong>{workspace.name}</strong><small>{workspace.slug}</small></div></td><td>{workspace.ownerEmail}</td><td><span className="usage-pair"><Users size={12} />{workspace.memberCount}<Server size={12} />{workspace.serverCount}</span></td><td><select className={`plan-select ${workspace.planCode}`} value={workspace.planCode} onChange={(event) => void changePlan(workspace, event.target.value as PlanCode)}>{PLANS.map((plan) => <option key={plan.code} value={plan.code}>{plan.name}</option>)}</select></td><td>{new Date(workspace.createdAt).toLocaleDateString()}</td></tr>)}</tbody></table>
        {!items.length && <div className="ops-empty"><Building2 size={22} /><p>No workspaces match this search.</p></div>}
      </section>
    </div>
  )
}
