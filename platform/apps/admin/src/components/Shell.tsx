import {
  Activity,
  Boxes,
  Building2,
  FileClock,
  Gauge,
  LogOut,
  Mail,
  PanelLeftClose,
  PanelLeftOpen,
  Rocket,
  Search,
  ServerCog,
  Users
} from 'lucide-react'
import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../context'
import { Logo } from './Logo'

const nav = [
  { to: '/', label: 'Overview', icon: Gauge },
  { to: '/workspaces', label: 'Workspaces', icon: Building2 },
  { to: '/users', label: 'Users', icon: Users },
  { to: '/requests', label: 'Plan requests', icon: Mail },
  { to: '/releases', label: 'Releases', icon: Rocket },
  { to: '/audit', label: 'Audit log', icon: FileClock }
]

export function Shell() {
  const [collapsed, setCollapsed] = useState(false)
  const { user, logout } = useAuth()
  return (
    <div className={`ops-shell ${collapsed ? 'collapsed' : ''}`}>
      <aside>
        <div className="ops-brand"><Logo compact={collapsed} /></div>
        <nav>
          <p>{collapsed ? '•••' : 'Platform'}</p>
          {nav.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === '/'} title={collapsed ? label : undefined}><Icon size={16} /><span>{label}</span></NavLink>)}
        </nav>
        <div className="ops-side-bottom">
          <button className="ops-user"><span>{user?.displayName.slice(0, 1)}</span><i><strong>{user?.displayName}</strong><small>Super administrator</small></i></button>
          <button onClick={() => setCollapsed(!collapsed)}>{collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}<span>Collapse</span></button>
          <button onClick={() => void logout()}><LogOut size={15} /><span>Sign out</span></button>
        </div>
      </aside>
      <section className="ops-workspace">
        <header className="ops-topbar">
          <div className="command-search"><Search size={14} /><span>Search anything…</span><kbd>⌘ K</kbd></div>
          <div><span className="environment"><i /> Production</span><span className="service-live"><Activity size={13} /> API healthy</span></div>
        </header>
        <main><Outlet /></main>
      </section>
    </div>
  )
}

export function Stat({
  icon: Icon,
  label,
  value,
  note,
  tone = 'purple'
}: {
  icon: typeof Boxes
  label: string
  value: string | number
  note: string
  tone?: string
}) {
  return <article className="ops-stat"><span className={tone}><Icon size={16} /></span><div><p>{label}</p><strong>{value}</strong><small>{note}</small></div></article>
}

export function PageLoader() {
  return <div className="ops-loader"><ServerCog size={25} /><span /></div>
}
