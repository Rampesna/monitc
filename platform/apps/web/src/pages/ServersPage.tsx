import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, MoreHorizontal, Plus, RefreshCw, Search, Server, ShieldCheck, Trash2 } from 'lucide-react'
import type { ServerSummary } from '@monitc/shared'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { timeAgo } from '../lib/format'
import { AddServerModal } from '../components/AddServerModal'
import { PageSkeleton } from '../components/Skeleton'

export function ServersPage() {
  const [servers, setServers] = useState<ServerSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [menu, setMenu] = useState<string | null>(null)

  const load = async () => {
    const data = await api<{ servers: ServerSummary[] }>('/api/v1/servers')
    setServers(data.servers)
  }
  useEffect(() => { load().finally(() => setLoading(false)) }, [])
  const visible = useMemo(
    () => servers.filter((server) => `${server.name} ${server.host || ''}`.toLowerCase().includes(query.toLowerCase())),
    [servers, query]
  )
  const refresh = async () => {
    setRefreshing(true)
    await load().finally(() => setRefreshing(false))
  }
  const remove = async (server: ServerSummary) => {
    if (!window.confirm(`Remove ${server.name}? Metric history for this server will also be deleted.`)) return
    await api(`/api/v1/servers/${server.id}`, { method: 'DELETE' })
    setServers((current) => current.filter((item) => item.id !== server.id))
  }
  if (loading) return <PageSkeleton />

  return (
    <div className="page servers-page">
      <div className="page-title">
        <div><p className="eyebrow">CONNECTIONS</p><h1>Servers</h1><p>Encrypted connections monitored from this workspace.</p></div>
        <button className="primary-button" onClick={() => setAddOpen(true)}><Plus size={15} /> Add server</button>
      </div>
      <div className="toolbar">
        <div className="search-field"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search servers…" /></div>
        <button className="secondary-button" onClick={() => void refresh()}><RefreshCw size={14} className={refreshing ? 'spin' : ''} /> Refresh</button>
      </div>
      <section className="server-grid">
        {visible.map((server) => (
          <article className="server-card" key={server.id}>
            <header>
              <span className={`server-card-icon ${server.status}`}><Server size={18} /></span>
              <div className="server-card-menu">
                <button className="icon-button" onClick={() => setMenu(menu === server.id ? null : server.id)}><MoreHorizontal size={17} /></button>
                {menu === server.id && <div className="context-menu"><button onClick={() => void remove(server)}><Trash2 size={13} /> Remove server</button></div>}
              </div>
            </header>
            <div className="server-card-copy"><h2>{server.name}</h2><p>{server.username ? `${server.username}@${server.host}:${server.port}` : 'Sealed connection'}</p></div>
            <div className="server-card-meta">
              <span><i className={server.status} /> {server.status}</span>
              <span>{timeAgo(server.lastSeenAt)}</span>
            </div>
            <div className="server-card-security"><ShieldCheck size={13} /> Secret sealed · {server.connectionMode.toUpperCase()}</div>
            <Link to={`/servers/${server.id}`}>Open workspace <ArrowRight size={14} /></Link>
          </article>
        ))}
        <button className="server-card add-server-card" onClick={() => setAddOpen(true)}><span><Plus size={20} /></span><strong>Add another server</strong><small>SSH or outbound agent</small></button>
      </section>
      {!visible.length && servers.length > 0 && <div className="page-empty"><Search size={24} /><h2>No matching servers</h2><p>Try another name or address.</p></div>}
      <AddServerModal open={addOpen} onClose={() => setAddOpen(false)} onCreated={(server) => setServers((current) => [server, ...current])} />
    </div>
  )
}
