import { useEffect, useState } from 'react'
import { ArrowRight, FileCode2, Server, TerminalSquare } from 'lucide-react'
import type { ServerSummary } from '@monitc/shared'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { PageSkeleton } from '../components/Skeleton'

export function SessionsPage() {
  const [servers, setServers] = useState<ServerSummary[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => { void api<{ servers: ServerSummary[] }>('/api/v1/servers').then((data) => setServers(data.servers)).finally(() => setLoading(false)) }, [])
  if (loading) return <PageSkeleton />
  return (
    <div className="page sessions-page">
      <div className="page-title"><div><p className="eyebrow">SECURE ACCESS</p><h1>Sessions</h1><p>Start an isolated terminal or SFTP workspace without exposing stored credentials.</p></div></div>
      <div className="session-grid">{servers.map((server) => <article className="session-card" key={server.id}><span className={`server-card-icon ${server.status}`}><Server size={18} /></span><div><h2>{server.name}</h2><p>{server.username}@{server.host}</p></div><div><Link to={`/servers/${server.id}?tab=terminal`}><TerminalSquare size={15} /> Terminal <ArrowRight size={13} /></Link><Link to={`/servers/${server.id}?tab=files`}><FileCode2 size={15} /> Files <ArrowRight size={13} /></Link></div></article>)}</div>
      {!servers.length && <div className="page-empty"><Server size={25} /><h2>No connection targets</h2><Link to="/servers">Add a server</Link></div>}
    </div>
  )
}
