import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Settings, Server, Link2, Bell, Sliders, GitBranch } from 'lucide-react'
import { ServersTab } from './ServersTab'
import { IntegrationsTab } from './IntegrationsTab'
import { AlertRulesTab } from './AlertRulesTab'
import { GeneralTab } from './GeneralTab'
import GitIntegrationsTab from './GitIntegrationsTab'

export function SettingsLayout(): React.ReactElement {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState('servers')

  const tabs = [
    { id: 'servers', label: t('settings.servers'), icon: Server },
    { id: 'integrations', label: t('settings.integrations'), icon: Link2 },
    { id: 'git', label: t('settings.git'), icon: GitBranch },
    { id: 'alert-rules', label: t('settings.alertRules'), icon: Bell },
    { id: 'general', label: t('settings.general'), icon: Sliders }
  ]

  return (
    <div className="flex h-full">
      <aside className="w-44 bg-[#0d0d14] border-r border-[#1e1e2e] py-6 flex-shrink-0">
        <div className="flex items-center gap-2 px-4 mb-4">
          <Settings size={16} className="text-slate-400" />
          <span className="text-sm font-semibold text-slate-200">{t('settings.title')}</span>
        </div>
        <nav className="space-y-0.5 px-2">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === id ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/20' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'}`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </nav>
      </aside>

      <main className="flex-1 overflow-y-auto p-6">
        {activeTab === 'servers' && <ServersTab />}
        {activeTab === 'integrations' && <IntegrationsTab />}
        {activeTab === 'git' && <GitIntegrationsTab />}
        {activeTab === 'alert-rules' && <AlertRulesTab />}
        {activeTab === 'general' && <GeneralTab />}
      </main>
    </div>
  )
}
