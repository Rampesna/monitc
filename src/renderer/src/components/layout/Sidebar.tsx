import React from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Server,
  Container,
  Box,
  ScrollText,
  Bell,
  Settings,
  ChevronLeft,
  ChevronRight,
  GitBranch,
  Rocket,
  Terminal,
  TerminalSquare
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useApp } from '../../context/AppContext'
import { StatusDot } from '../common/StatusDot'

export function Sidebar(): React.ReactElement {
  const { t } = useTranslation()
  const { state, dispatch } = useApp()
  const location = useLocation()
  const navigate = useNavigate()
  const collapsed = state.preferences.sidebarCollapsed

  const mainNavItems = [
    { to: '/', icon: LayoutDashboard, label: t('nav.dashboard') },
    { to: '/docker', icon: Container, label: t('nav.docker') },
    { to: '/kubernetes', icon: Box, label: t('nav.kubernetes') },
    { to: '/k8s-manage', icon: Terminal, label: t('nav.k8sManage') },
    { to: '/cicd', icon: GitBranch, label: t('nav.cicd') },
    { to: '/deploy', icon: Rocket, label: t('nav.deploy') },
    { to: '/terminal', icon: TerminalSquare, label: t('nav.terminal') },
    { to: '/logs', icon: ScrollText, label: t('nav.logs') },
    { to: '/alerts', icon: Bell, label: t('nav.alerts') },
    { to: '/settings', icon: Settings, label: t('nav.settings') }
  ]

  const selectedServer = state.servers.find((s) => s.id === state.selectedServerId)

  const toggle = (): void => {
    dispatch({
      type: 'SET_PREFERENCES',
      prefs: { ...state.preferences, sidebarCollapsed: !collapsed }
    })
    window.monitcAPI.preferences.save({ ...state.preferences, sidebarCollapsed: !collapsed }).catch(console.error)
  }

  const isServersActive = location.pathname === '/servers'
  const isDashboardActive = location.pathname === '/'

  return (
    <aside className={`flex flex-col h-full bg-[#0d0d14] border-r border-[#1e1e2e] transition-all duration-200 ${collapsed ? 'w-14' : 'w-56'} flex-shrink-0`}>

      {!collapsed && selectedServer && (
        <div className="px-3 py-2 border-b border-[#1e1e2e]">
          <div className="bg-[#12121a] rounded-lg p-2.5">
            <div className="flex items-center gap-2 mb-1">
              <Server size={12} className="text-slate-400" />
              <span className="text-xs font-medium text-slate-300 truncate">{selectedServer.name}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <StatusDot status={(state.connectionStatuses[selectedServer.id] ?? 'disconnected')} size="sm" showLabel />
            </div>
          </div>
        </div>
      )}

      <nav className="flex-1 py-2 overflow-y-auto">
        {/* Servers item */}
        <button
          onClick={() => navigate('/servers')}
          className={`w-full flex items-center gap-3 px-3 py-2.5 mx-2 rounded-lg text-sm font-medium transition-all duration-150 no-drag ${
            isServersActive
              ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
          } ${collapsed ? 'justify-center' : ''}`}
          style={{ width: collapsed ? undefined : 'calc(100% - 16px)' }}
          title={collapsed ? t('nav.servers') : undefined}
        >
          <Server size={16} className="flex-shrink-0" />
          {!collapsed && t('nav.servers')}
        </button>

        {/* Divider */}
        <div className={`my-1.5 ${collapsed ? 'mx-3' : 'mx-2'} border-t border-[#1e1e2e]`} />

        {/* Dashboard + rest of nav */}
        {mainNavItems.map(({ to, icon: Icon, label }) => {
          const isActive = to === '/'
            ? isDashboardActive
            : location.pathname.startsWith(to)
          return (
            <NavLink
              key={to}
              to={to}
              className={`flex items-center gap-3 px-3 py-2.5 mx-2 rounded-lg text-sm font-medium transition-all duration-150 no-drag ${
                isActive
                  ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              } ${collapsed ? 'justify-center' : ''}`}
              title={collapsed ? label : undefined}
            >
              <Icon size={16} className="flex-shrink-0" />
              {!collapsed && label}
            </NavLink>
          )
        })}
      </nav>

      <div className="border-t border-[#1e1e2e] px-2 py-2 flex items-center justify-between gap-1">
        {!collapsed && (
          <span className="text-[11px] text-slate-600 pl-1 select-none">v{__APP_VERSION__ ?? '1.0.0'}</span>
        )}
        <button
          onClick={toggle}
          className={`flex items-center justify-center p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors no-drag ${collapsed ? 'w-full' : 'ml-auto'}`}
          title={collapsed ? 'Genişlet' : 'Daralt'}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>
    </aside>
  )
}
