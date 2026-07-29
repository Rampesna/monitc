import { useEffect, useState } from 'react'
import { FileClock, ShieldCheck } from 'lucide-react'
import { api } from '../lib/api'
import { PageLoader } from '../components/Shell'

interface AuditEntry {
  id: number
  workspaceId: string | null
  actorEmail: string | null
  action: string
  resourceType: string
  resourceId: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

export function AuditPage() {
  const [items, setItems] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => { void api<{ entries: AuditEntry[] }>('/api/v1/admin/audit').then((data) => setItems(data.entries)).finally(() => setLoading(false)) }, [])
  if (loading) return <PageLoader />
  return (
    <div className="ops-page">
      <header className="ops-page-title"><div><p>IMMUTABLE CONTEXT</p><h1>Audit log</h1><span>Recent security, billing and infrastructure actions.</span></div><span className="audit-note"><ShieldCheck size={13} /> 300 latest events</span></header>
      <section className="ops-table-panel audit-table"><table><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Resource</th><th>Context</th></tr></thead><tbody>{items.map((entry) => <tr key={entry.id}><td>{new Date(entry.createdAt).toLocaleString()}</td><td>{entry.actorEmail || 'system'}</td><td><code>{entry.action}</code></td><td><strong>{entry.resourceType}</strong><small>{entry.resourceId || '—'}</small></td><td><pre>{Object.keys(entry.metadata).length ? JSON.stringify(entry.metadata) : '—'}</pre></td></tr>)}</tbody></table>{!items.length && <div className="ops-empty"><FileClock size={22} /><p>No audit events yet.</p></div>}</section>
    </div>
  )
}
