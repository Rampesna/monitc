import React from 'react'
import { NavLink, useLocation } from 'react-router-dom'
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
  Activity,
  GitBranch,
  Rocket,
  Terminal
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useApp } from '../../context/AppContext'
import { StatusDot } from '../common/StatusDot'

export function Sidebar(): React.ReactElement {
  const { t } = useTranslation()
  const { state, dispatch } = useApp()
  const location = useLocation()
  const collapsed = state.preferences.sidebarCollapsed

  const navItems = [
    { to: '/', icon: LayoutDashboard, label: t('nav.dashboard') },
    { to: '/docker', icon: Container, label: t('nav.docker') },
    { to: '/kubernetes', icon: Box, label: t('nav.kubernetes') },
    { to: '/k8s-manage', icon: Terminal, label: t('nav.k8sManage') },
    { to: '/cicd', icon: GitBranch, label: t('nav.cicd') },
    { to: '/deploy', icon: Rocket, label: t('nav.deploy') },
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

  return (
    <aside className={`flex flex-col h-full bg-[#0d0d14] border-r border-[#1e1e2e] transition-all duration-200 ${collapsed ? 'w-14' : 'w-56'} flex-shrink-0`}>
      <div className={`flex items-center gap-2 px-4 py-4 border-b border-[#1e1e2e] ${collapsed ? 'justify-center px-0' : ''}`}>
        <Activity size={20} className="text-indigo-400 flex-shrink-0" />
        {!collapsed && <span className="font-bold text-slate-100 text-base">monitc</span>}
      </div>

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
        {navItems.map(({ to, icon: Icon, label }) => {
          const isActive = to === '/' ? location.pathname === '/' : location.pathname.startsWith(to)
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

      {!collapsed && (
        <div className="px-3 py-2 border-t border-[#1e1e2e]">
          <div className="text-xs text-slate-600 text-center">v{__APP_VERSION__ ?? '1.0.0'}</div>
        </div>
      )}

      <button
        onClick={toggle}
        className="flex items-center justify-center p-2 mx-2 mb-2 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors no-drag"
      >
        {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
      </button>
    </aside>
  )
}
