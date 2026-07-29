import { useEffect, useState } from 'react'
import { ArrowRight, Check, Clock3, Mail, MessageSquare, X } from 'lucide-react'
import { api, json } from '../lib/api'
import { PageLoader } from '../components/Shell'

interface Request {
  id: string
  workspaceId: string
  workspaceName: string
  email: string
  planCode: string
  message: string | null
  status: 'new' | 'contacted' | 'approved' | 'rejected'
  createdAt: string
}

export function RequestsPage() {
  const [items, setItems] = useState<Request[]>([])
  const [loading, setLoading] = useState(true)
  const load = async () => {
    const data = await api<{ requests: Request[] }>('/api/v1/admin/contact-requests')
    setItems(data.requests)
  }
  useEffect(() => { void load().finally(() => setLoading(false)) }, [])
  const update = async (item: Request, status: Request['status']) => {
    await api(`/api/v1/admin/contact-requests/${item.id}`, { method: 'PATCH', ...json({ status }) })
    setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, status } : entry))
  }
  if (loading) return <PageLoader />
  return (
    <div className="ops-page">
      <header className="ops-page-title"><div><p>COMMERCIAL INBOX</p><h1>Plan requests</h1><span>Follow up, approve and assign packages manually.</span></div><span className="request-count"><Mail size={13} /> {items.filter((item) => item.status === 'new').length} new</span></header>
      <section className="request-list">{items.map((item) => <article className={`request-card status-${item.status}`} key={item.id}><span className="request-icon"><MessageSquare size={16} /></span><div className="request-main"><header><div><h2>{item.workspaceName}</h2><p>{item.email}</p></div><span className={`request-status ${item.status}`}><i />{item.status}</span></header><p className="request-message">{item.message || `Interested in the ${item.planCode} plan.`}</p><footer><span><Clock3 size={11} /> {new Date(item.createdAt).toLocaleString()}</span><span className="requested-plan">{item.planCode}</span></footer></div><div className="request-actions">{item.status === 'new' && <button onClick={() => void update(item, 'contacted')}><Mail size={13} /> Mark contacted</button>}<button className="approve" onClick={async () => { await api(`/api/v1/admin/workspaces/${item.workspaceId}/plan`, { method: 'PATCH', ...json({ planCode: item.planCode }) }); await update(item, 'approved') }}><Check size={13} /> Approve & activate</button><button className="reject" onClick={() => void update(item, 'rejected')}><X size={13} /></button></div></article>)}</section>
      {!items.length && <div className="ops-empty large"><Mail size={24} /><h2>Inbox is clear</h2><p>New manual plan requests will appear here.</p></div>}
    </div>
  )
}
