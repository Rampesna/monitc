import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router'
import { Settings, Server, Link2, Bell, Sliders, GitBranch } from 'lucide-react'
import { ServersTab } from './ServersTab'
import { IntegrationsTab } from './IntegrationsTab'
import { AlertRulesTab } from './AlertRulesTab'
import { GeneralTab } from './GeneralTab'
import GitIntegrationsTab from './GitIntegrationsTab'

const SETTINGS_TABS = ['servers', 'integrations', 'git', 'alert-rules', 'general'] as const
type SettingsTab = typeof SETTINGS_TABS[number]

function requestedTab(search: string): SettingsTab {
  const candidate = new URLSearchParams(search).get('tab')
  return SETTINGS_TABS.includes(candidate as SettingsTab) ? candidate as SettingsTab : 'servers'
}

export function SettingsLayout(): React.ReactElement {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => requestedTab(location.search))

  useEffect(() => {
    setActiveTab(requestedTab(location.search))
  }, [location.search])

  const selectTab = (tab: SettingsTab): void => {
    setActiveTab(tab)
    navigate(`/settings?tab=${tab}`, { replace: true })
  }

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
                onClick={() => selectTab(id as SettingsTab)}
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
