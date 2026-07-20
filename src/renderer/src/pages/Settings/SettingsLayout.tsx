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
    <div className="settings-page h-full p-6">
      <header className="settings-header">
        <div>
          <p className="section-eyebrow">WORKSPACE</p>
          <h1>{t('settings.title')}</h1>
        </div>
        <Settings size={19} />
      </header>
      <div className="settings-body">
        <aside className="settings-nav">
          <div className="settings-nav-label">PREFERENCES</div>
          <nav>
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={activeTab === id ? 'active' : ''}
              >
                <Icon size={14} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </aside>

        <main className="settings-content">
          {activeTab === 'servers' && <ServersTab />}
          {activeTab === 'integrations' && <IntegrationsTab />}
          {activeTab === 'git' && <GitIntegrationsTab />}
          {activeTab === 'alert-rules' && <AlertRulesTab />}
          {activeTab === 'general' && <GeneralTab />}
        </main>
      </div>
    </div>
  )
}
