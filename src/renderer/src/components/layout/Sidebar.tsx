import React from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  Bell,
  Box,
  Container,
  FolderOpen,
  GitBranch,
  LayoutDashboard,
  Rocket,
  ScrollText,
  Server,
  Settings,
  Terminal,
  TerminalSquare
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function Sidebar(): React.ReactElement {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const isServersActive = location.pathname === '/servers'

  const navItems = [
    { to: '/', icon: LayoutDashboard, label: t('nav.dashboard') },
    { to: '/docker', icon: Container, label: t('nav.docker') },
    { to: '/kubernetes', icon: Box, label: t('nav.kubernetes') },
    { to: '/k8s-manage', icon: Terminal, label: t('nav.k8sManage') },
    { to: '/cicd', icon: GitBranch, label: t('nav.cicd') },
    { to: '/deploy', icon: Rocket, label: t('nav.deploy') },
    { to: '/terminal', icon: TerminalSquare, label: t('nav.terminal') },
    { to: '/sftp', icon: FolderOpen, label: t('nav.files') },
    { to: '/logs', icon: ScrollText, label: t('nav.logs') },
    { to: '/alerts', icon: Bell, label: t('nav.alerts') },
    { to: '/settings', icon: Settings, label: t('nav.settings') }
  ]

  return (
    <aside className="app-sidebar flex flex-col h-full flex-shrink-0">
      <button className="sidebar-brand no-drag" onClick={() => navigate('/')} title="monitc">
        <span className="sidebar-brand-glyph" />
      </button>

      <nav className="sidebar-nav flex-1 overflow-y-auto">
        <button
          onClick={() => navigate('/servers')}
          className={`sidebar-link no-drag ${isServersActive ? 'active' : ''}`}
          title={t('nav.servers')}
        >
          <Server size={18} />
          <span className="sidebar-tooltip">{t('nav.servers')}</span>
        </button>

        <div className="sidebar-divider" />

        {navItems.map(({ to, icon: Icon, label }) => {
          const isActive = to === '/' ? location.pathname === '/' : location.pathname.startsWith(to)
          return (
            <NavLink key={to} to={to} className={`sidebar-link no-drag ${isActive ? 'active' : ''}`} title={label}>
              <Icon size={18} />
              <span className="sidebar-tooltip">{label}</span>
            </NavLink>
          )
        })}
      </nav>

      <div className="sidebar-version">v{__APP_VERSION__ ?? '1.0.0'}</div>
    </aside>
  )
}
