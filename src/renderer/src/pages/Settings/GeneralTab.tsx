import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sliders, Shield, Trash2, Eye, EyeOff, Copy } from 'lucide-react'
import { Card } from '../../components/common/Card'
import { Button } from '../../components/common/Button'
import { useApp } from '../../context/AppContext'
import type { AppPreferences } from '../../lib/types'

export function GeneralTab(): React.ReactElement {
  const { t } = useTranslation()
  const { state, dispatch } = useApp()
  const [prefs, setPrefs] = useState<AppPreferences>({ ...state.preferences })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [resetting, setResetting] = useState(false)

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    try {
      await window.monitcAPI.preferences.save(prefs)
      dispatch({ type: 'SET_PREFERENCES', prefs })
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

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sliders size={16} className="text-indigo-400" />
          <h2 className="text-base font-semibold text-slate-100">{t('generalTab.title')}</h2>
        </div>
        <Button variant="primary" size="sm" loading={saving} onClick={handleSave}>
          {saved ? t('generalTab.preferencesSaved') : t('generalTab.savePreferences')}
        </Button>
      </div>

      <Card className="space-y-4">
        <h3 className="text-sm font-semibold text-slate-200">{t('generalTab.theme')}</h3>
        <div className="flex gap-2">
          {(['dark', 'light', 'system'] as const).map((themeOpt) => (
            <button
              key={themeOpt}
              onClick={() => setPrefs((p) => ({ ...p, theme: themeOpt }))}
              className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-colors ${prefs.theme === themeOpt ? 'bg-indigo-600/20 border-indigo-500/30 text-indigo-300' : 'bg-[#0d0d14] border-[#1e1e2e] text-slate-400 hover:border-[#2d2d45]'}`}
            >
              {themeOpt === 'dark' ? t('generalTab.themeDark') : themeOpt === 'light' ? t('generalTab.themeLight') : t('generalTab.themeSystem')}
            </button>
          ))}
        </div>
      </Card>

      <Card className="space-y-4">
        <h3 className="text-sm font-semibold text-slate-200">{t('generalTab.pollIntervals')}</h3>
        <div className="grid grid-cols-1 gap-3">
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

      <Card className="space-y-4">
        <div className="flex items-center gap-2">
          <Shield size={14} className="text-indigo-400" />
          <h3 className="text-sm font-semibold text-slate-200">{t('generalTab.licenseKey')}</h3>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 font-mono text-sm bg-[#0d0d14] border border-[#1e1e2e] rounded-lg px-3 py-2 text-slate-300 tracking-widest">
            {showKey ? state.licenseKey : '****-****-****-****-****-****'}
          </div>
          <button
            onClick={() => setShowKey((s) => !s)}
            className="p-2 rounded-lg hover:bg-white/5 text-slate-400 hover:text-slate-200 transition-colors"
            title={showKey ? t('generalTab.hideKey') : t('generalTab.showKey')}
          >
            {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button
            onClick={() => navigator.clipboard.writeText(state.licenseKey ?? '')}
            className="p-2 rounded-lg hover:bg-white/5 text-slate-400 hover:text-slate-200 transition-colors"
            title={t('generalTab.copyKey')}
          >
            <Copy size={14} />
          </button>
        </div>
      </Card>

      <Card className="space-y-4">
        <div className="flex items-center gap-2">
          <Trash2 size={14} className="text-red-400" />
          <h3 className="text-sm font-semibold text-red-400">{t('generalTab.dangerZone')}</h3>
        </div>
        <p className="text-xs text-slate-500">{t('generalTab.resetConfirm')}</p>
        <Button variant="danger" size="sm" icon={<Trash2 size={12} />} loading={resetting} onClick={handleReset}>
          {t('generalTab.resetData')}
        </Button>
      </Card>
    </div>
  )
}
