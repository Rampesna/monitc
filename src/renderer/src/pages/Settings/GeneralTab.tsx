import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, Languages, Monitor, Moon, RefreshCw, Sliders, Sun, Timer, Trash2 } from 'lucide-react'
import { Card } from '../../components/common/Card'
import { Button } from '../../components/common/Button'
import { useApp } from '../../context/AppContext'
import { LANGUAGES, applyLanguage } from '../../i18n'
import type { AppPreferences } from '../../lib/types'
import { useAppUpdater } from '../../hooks/useAppUpdater'

export function GeneralTab(): React.ReactElement {
  const { t } = useTranslation()
  const { state, dispatch } = useApp()
  const [prefs, setPrefs] = useState<AppPreferences>({ ...state.preferences })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [resetting, setResetting] = useState(false)
  const updater = useAppUpdater()

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    try {
      await window.monitcAPI.preferences.save(prefs)
      dispatch({ type: 'SET_PREFERENCES', prefs })
      applyLanguage(prefs.language ?? 'en')
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally { setSaving(false) }
  }

  const handleReset = async (): Promise<void> => {
    if (!confirm(t('generalTab.resetConfirm'))) return
    setResetting(true)
    try {
      await window.monitcAPI.app.resetData()
      window.location.reload()
    } finally { setResetting(false) }
  }

  const intervalOptions = [
    { value: 5, label: '5s' },
    { value: 10, label: '10s' },
    { value: 15, label: '15s' },
    { value: 30, label: '30s' },
    { value: 60, label: '60s' }
  ]

  const dockerIntervalOptions = [
    { value: 10, label: '10s' },
    { value: 15, label: '15s' },
    { value: 30, label: '30s' },
    { value: 60, label: '60s' },
    { value: 120, label: '120s' }
  ]

  const selectCls = "w-full bg-[#0d0d14] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"

  const updaterStatus = (() => {
    switch (updater.state.status) {
      case 'checking': return t('updater.checking')
      case 'available': return t('updater.availableTitle', { version: updater.state.version })
      case 'downloading': return t('updater.downloadingDesc', { percent: updater.state.percent ?? 0 })
      case 'ready': return t('updater.readyTitle', { version: updater.state.version })
      case 'installing': return t('updater.installingDesc')
      case 'uptodate': return t('updater.upToDate')
      case 'error': return updater.state.message ?? t('updater.errorDesc')
      default: return t('updater.autoCheckEnabled')
    }
  })()

  const handleUpdaterAction = async (): Promise<void> => {
    if (updater.state.status === 'available') await updater.update()
    else if (updater.state.status === 'ready') await updater.install()
    else await updater.check()
  }

  const themeOptions = [
    { value: 'dark' as const, label: t('generalTab.themeDark'), icon: Moon },
    { value: 'light' as const, label: t('generalTab.themeLight'), icon: Sun },
    { value: 'system' as const, label: t('generalTab.themeSystem'), icon: Monitor }
  ]

  return (
    <div className="general-settings">
      <div className="settings-section-header">
        <div className="settings-section-title">
          <span><Sliders size={15} /></span>
          <div><h2>{t('generalTab.title')}</h2></div>
        </div>
        <Button variant="primary" size="sm" loading={saving} onClick={handleSave}>
          {saved ? t('generalTab.preferencesSaved') : t('generalTab.savePreferences')}
        </Button>
      </div>

      <div className="settings-preference-grid">
        <Card className="settings-soft-card settings-theme-card">
          <div className="settings-card-heading"><Moon size={14} /><h3>{t('generalTab.theme')}</h3></div>
          <div className="settings-theme-options">
          {themeOptions.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={() => setPrefs((p) => ({ ...p, theme: value }))}
              className={`settings-choice ${prefs.theme === value ? 'is-selected' : ''}`}
            >
              <Icon size={15} /><span>{label}</span>
            </button>
          ))}
          </div>
        </Card>

        <Card className="settings-soft-card settings-language-card">
          <div className="settings-card-heading"><Languages size={14} /><h3>{t('generalTab.language')}</h3></div>
          <div className="settings-language-grid">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              onClick={() => setPrefs((p) => ({ ...p, language: lang.code }))}
              className={`settings-language-choice ${(prefs.language ?? 'en') === lang.code ? 'is-selected' : ''}`}
            >
              <span>{lang.nativeLabel}</span>
              <small>{lang.label}</small>
            </button>
          ))}
          </div>
        </Card>

        <Card className="settings-soft-card settings-update-card">
          <div className="settings-update-copy">
            <div className="settings-card-icon">
              <RefreshCw size={14} className={`text-indigo-400 ${updater.state.status === 'checking' ? 'animate-spin' : ''}`} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-200">{t('updater.settingsTitle')}</h3>
              <p className={`text-xs mt-1 ${updater.state.status === 'error' ? 'text-red-400' : 'text-slate-500'}`}>{updaterStatus}</p>
              <p className="text-[11px] text-slate-600 mt-1">
                {t('updater.currentVersion', { version: updater.state.currentVersion || __APP_VERSION__ })}
                {updater.state.lastCheckedAt ? ` · ${t('updater.lastChecked', { date: new Date(updater.state.lastCheckedAt).toLocaleString() })}` : ''}
              </p>
            </div>
          </div>
          <Button
            variant={updater.state.status === 'available' || updater.state.status === 'ready' ? 'primary' : 'secondary'}
            size="sm"
            loading={updater.state.status === 'checking' || updater.state.status === 'downloading' || updater.state.status === 'installing'}
            disabled={updater.state.status === 'downloading' || updater.state.status === 'installing'}
            icon={updater.state.status === 'available' ? <Download size={12} /> : <RefreshCw size={12} />}
            onClick={handleUpdaterAction}
          >
            {updater.state.status === 'available' ? t('updater.updateNow') : updater.state.status === 'ready' ? t('updater.restart') : t('updater.checkNow')}
          </Button>
        </Card>

        <Card className="settings-soft-card settings-poll-card">
          <div className="settings-card-heading"><Timer size={14} /><h3>{t('generalTab.pollIntervals')}</h3></div>
          <div className="settings-poll-grid">
          <div>
            <label className="text-xs text-slate-400 mb-1 block">{t('generalTab.systemInterval')}</label>
            <select value={prefs.pollIntervals.system} onChange={(e) => setPrefs((p) => ({ ...p, pollIntervals: { ...p.pollIntervals, system: Number(e.target.value) } }))} className={selectCls}>
              {intervalOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">{t('generalTab.dockerInterval')}</label>
            <select value={prefs.pollIntervals.docker} onChange={(e) => setPrefs((p) => ({ ...p, pollIntervals: { ...p.pollIntervals, docker: Number(e.target.value) } }))} className={selectCls}>
              {dockerIntervalOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">{t('generalTab.kubernetesInterval')}</label>
            <select value={prefs.pollIntervals.kubernetes} onChange={(e) => setPrefs((p) => ({ ...p, pollIntervals: { ...p.pollIntervals, kubernetes: Number(e.target.value) } }))} className={selectCls}>
              {dockerIntervalOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          </div>
        </Card>

        <Card className="settings-soft-card settings-danger-card">
          <div>
            <div className="settings-card-heading"><Trash2 size={14} /><h3>{t('generalTab.dangerZone')}</h3></div>
            <p>{t('generalTab.resetConfirm')}</p>
          </div>
          <Button variant="danger" size="sm" icon={<Trash2 size={12} />} loading={resetting} onClick={handleReset}>
            {t('generalTab.resetData')}
          </Button>
        </Card>
      </div>
    </div>
  )
}
