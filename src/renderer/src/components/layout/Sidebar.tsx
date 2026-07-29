import React from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router'
import {
  Bell,
  Box,
  ChevronLeft,
  ChevronRight,
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
import { useApp } from '../../context/AppContext'

export function Sidebar(): React.ReactElement {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const { state, dispatch } = useApp()
  const isServersActive = location.pathname === '/servers'
  const collapsed = state.preferences.sidebarCollapsed

  const toggleSidebar = async (): Promise<void> => {
    const prefs = { ...state.preferences, sidebarCollapsed: !collapsed, sidebarPreferenceSet: true }
    dispatch({ type: 'SET_PREFERENCES', prefs })
    try {
      await window.monitcAPI.preferences.save(prefs)
    } catch (error) {
      dispatch({ type: 'SET_PREFERENCES', prefs: state.preferences })
      console.error(error)
    }
  }

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
    <aside className={`app-sidebar flex flex-col h-full flex-shrink-0 ${collapsed ? 'is-collapsed' : 'is-expanded'}`}>
      <button className="sidebar-brand no-drag" onClick={() => navigate('/')} title="monitc">
        <span className="sidebar-brand-mark"><span className="sidebar-brand-glyph" /></span>
        <span className="sidebar-brand-name">monitc</span>
      </button>

      <nav className="sidebar-nav flex-1 overflow-y-auto">
        <button
          onClick={() => navigate('/servers')}
          className={`sidebar-link no-drag ${isServersActive ? 'active' : ''}`}
          title={t('nav.servers')}
        >
          <Server size={18} />
          <span className="sidebar-label">{t('nav.servers')}</span>
          <span className="sidebar-tooltip">{t('nav.servers')}</span>
        </button>

        <div className="sidebar-divider" />

        {navItems.map(({ to, icon: Icon, label }) => {
          const isActive = to === '/' ? location.pathname === '/' : location.pathname.startsWith(to)
          return (
            <NavLink key={to} to={to} className={`sidebar-link no-drag ${isActive ? 'active' : ''}`} title={label}>
              <Icon size={18} />
              <span className="sidebar-label">{label}</span>
              <span className="sidebar-tooltip">{label}</span>
            </NavLink>
          )
        })}
      </nav>

      <div className="sidebar-footer">
        <button
          type="button"
          className="sidebar-collapse no-drag"
          onClick={toggleSidebar}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
          <span className="sidebar-label">Collapse</span>
        </button>
        <div className="sidebar-version">v{__APP_VERSION__ ?? '1.0.0'}</div>
      </div>
    </aside>
  )
}
