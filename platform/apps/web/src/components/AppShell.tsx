import { useState } from 'react'
import {
  Activity,
  Bell,
  Boxes,
  ChevronLeft,
  CreditCard,
  Gauge,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Server,
  Settings,
  ShieldCheck,
  TerminalSquare
} from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../context'
import { Logo } from './Logo'

const primary = [
  { to: '/', label: 'Overview', icon: Gauge },
  { to: '/servers', label: 'Servers', icon: Server },
  { to: '/workloads', label: 'Workloads', icon: Boxes },
  { to: '/sessions', label: 'Sessions', icon: TerminalSquare },
  { to: '/alerts', label: 'Alerts', icon: Bell }
]
const secondary = [
  { to: '/billing', label: 'Plan & billing', icon: CreditCard },
  { to: '/settings', label: 'Settings', icon: Settings }
]

export function AppShell() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('monitc-web-sidebar') === 'collapsed')
  const { user, workspace, logout } = useAuth()
  const toggle = (): void => {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem('monitc-web-sidebar', next ? 'collapsed' : 'expanded')
  }

  return (
    <div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar-brand"><Logo compact={collapsed} /></div>
        <nav>
          <p className="nav-label">{collapsed ? '•••' : 'Workspace'}</p>
          {primary.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === '/'} title={collapsed ? label : undefined}>
              <Icon size={17} /><span>{label}</span>
            </NavLink>
          ))}
          <p className="nav-label lower">{collapsed ? '•••' : 'Manage'}</p>
          {secondary.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} title={collapsed ? label : undefined}>
              <Icon size={17} /><span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button className="sidebar-account" title={collapsed ? user?.email : undefined}>
            <span className="avatar">{user?.displayName?.slice(0, 1).toUpperCase()}</span>
            <span><strong>{user?.displayName}</strong><small>{user?.email}</small></span>
          </button>
          <button className="collapse-button" onClick={toggle}>
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            <span>{collapsed ? '' : 'Collapse'}</span>
          </button>
          <button className="logout-button" onClick={() => void logout()} title="Sign out">
            <LogOut size={15} /><span>Sign out</span>
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="topbar-path">
            <span>monitc</span><ChevronLeft size={12} className="slash" />
            <strong>{workspace?.name}</strong>
          </div>
          <div className="topbar-right">
            <span className="plan-chip"><ShieldCheck size={13} /> {workspace?.plan.name}</span>
            <span className="live-chip"><i /><Activity size={13} /> Cloud live</span>
          </div>
        </header>
        <main className="content"><Outlet /></main>
      </div>
    </div>
  )
}
