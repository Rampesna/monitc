import { useEffect, useState } from 'react'
import { Search, ShieldCheck, UserRound } from 'lucide-react'
import { api } from '../lib/api'
import { PageLoader } from '../components/Shell'

interface User {
  id: string
  email: string
  displayName: string
  globalRole: string
  disabled: boolean
  lastLoginAt: string | null
  createdAt: string
  workspaceCount: number
}

export function UsersPage() {
  const [items, setItems] = useState<User[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void api<{ users: User[] }>(`/api/v1/admin/users?q=${encodeURIComponent(query)}`).then((data) => setItems(data.users)).finally(() => setLoading(false))
    }, 180)
    return () => window.clearTimeout(timer)
  }, [query])
  if (loading) return <PageLoader />
  return (
    <div className="ops-page">
      <header className="ops-page-title"><div><p>IDENTITIES</p><h1>Users</h1><span>Account posture and platform-level access.</span></div></header>
      <div className="ops-table-toolbar"><div><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search names or email…" /></div><span>{items.length} users</span></div>
      <section className="ops-table-panel"><table><thead><tr><th>User</th><th>Role</th><th>Workspaces</th><th>Last login</th><th>Joined</th><th>Status</th></tr></thead><tbody>{items.map((user) => <tr key={user.id}><td><span className="user-avatar">{user.displayName.slice(0, 1)}</span><div><strong>{user.displayName}</strong><small>{user.email}</small></div></td><td><span className={`role-badge ${user.globalRole}`}><ShieldCheck size={11} />{user.globalRole.replace('_', ' ')}</span></td><td>{user.workspaceCount}</td><td>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'Never'}</td><td>{new Date(user.createdAt).toLocaleDateString()}</td><td><span className={`state-dot ${user.disabled ? 'disabled' : 'active'}`}><i />{user.disabled ? 'Disabled' : 'Active'}</span></td></tr>)}</tbody></table>{!items.length && <div className="ops-empty"><UserRound size={22} /><p>No users match this search.</p></div>}</section>
    </div>
  )
}
