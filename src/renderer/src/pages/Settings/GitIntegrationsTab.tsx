import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { GitHubConfig, GitLabConfig } from '../../lib/types'

interface ProviderCardProps {
  title: string
  icon: string
  config: GitHubConfig | GitLabConfig
  onChange: (cfg: GitHubConfig | GitLabConfig) => void
  onTest: () => Promise<void>
  testing: boolean
  testResult: { success: boolean; message: string } | null
  baseUrlPlaceholder: string
}

function ProviderCard({ title, icon, config, onChange, onTest, testing, testResult, baseUrlPlaceholder }: ProviderCardProps) {
  const { t } = useTranslation()
  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{icon}</span>
          <h3 className="font-semibold text-slate-100">{title}</h3>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => onChange({ ...config, enabled: e.target.checked })}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-slate-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600" />
        </label>
      </div>

      {config.enabled && (
        <>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Personal Access Token</label>
            <input
              type="password"
              value={config.pat}
              onChange={(e) => onChange({ ...config, pat: e.target.value })}
              placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
              className="w-full bg-slate-900/60 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500/70"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              {t('gitTab.baseUrlLabel')} <span className="text-slate-500">({t('gitTab.baseUrlHint')})</span>
            </label>
            <input
              type="text"
              value={config.baseUrl}
              onChange={(e) => onChange({ ...config, baseUrl: e.target.value })}
              placeholder={baseUrlPlaceholder}
              className="w-full bg-slate-900/60 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500/70"
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onTest}
              disabled={testing || !config.pat}
              className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 rounded-lg text-sm font-medium text-slate-100 transition-colors"
            >
              {testing ? (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
              {t('gitTab.testConnection')}
            </button>
            {testResult && (
              <span className={`text-sm ${testResult.success ? 'text-green-400' : 'text-red-400'}`}>
                {testResult.message}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}

const DEFAULT_GH: GitHubConfig = { enabled: false, pat: '', baseUrl: 'https://api.github.com' }
const DEFAULT_GL: GitLabConfig = { enabled: false, pat: '', baseUrl: 'https://gitlab.com' }

export default function GitIntegrationsTab() {
  const { t } = useTranslation()
  const [github, setGithub] = useState<GitHubConfig>(DEFAULT_GH)
  const [gitlab, setGitlab] = useState<GitLabConfig>(DEFAULT_GL)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [ghTesting, setGhTesting] = useState(false)
  const [glTesting, setGlTesting] = useState(false)
  const [ghResult, setGhResult] = useState<{ success: boolean; message: string } | null>(null)
  const [glResult, setGlResult] = useState<{ success: boolean; message: string } | null>(null)

  useEffect(() => {
    window.monitcAPI.settings.getIntegrations().then((data) => {
      const d = data as { github?: GitHubConfig; gitlab?: GitLabConfig }
      if (d.github) setGithub(d.github)
      if (d.gitlab) setGitlab(d.gitlab)
    })
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      const current = await window.monitcAPI.settings.getIntegrations() as Record<string, unknown>
      await window.monitcAPI.settings.saveIntegrations({ ...current, github, gitlab })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  const testGithub = async () => {
    setGhTesting(true)
    setGhResult(null)
    try {
      const res = await window.monitcAPI.github.test(github) as { success: boolean; login?: string; error?: string }
      setGhResult(res.success
        ? { success: true, message: t('gitTab.connected', { user: res.login }) }
        : { success: false, message: res.error ?? t('common.error') })
    } catch (err) {
      setGhResult({ success: false, message: (err as Error).message })
    } finally {
      setGhTesting(false)
    }
  }

  const testGitlab = async () => {
    setGlTesting(true)
    setGlResult(null)
    try {
      const res = await window.monitcAPI.gitlab.test(gitlab) as { success: boolean; username?: string; error?: string }
      setGlResult(res.success
        ? { success: true, message: t('gitTab.connected', { user: res.username }) }
        : { success: false, message: res.error ?? t('common.error') })
    } catch (err) {
      setGlResult({ success: false, message: (err as Error).message })
    } finally {
      setGlTesting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-100">{t('gitTab.title')}</h2>
        <p className="text-sm text-slate-400 mt-1">{t('gitTab.subtitle')}</p>
      </div>

      <ProviderCard
        title="GitHub"
        icon="🐙"
        config={github}
        onChange={(c) => setGithub(c as GitHubConfig)}
        onTest={testGithub}
        testing={ghTesting}
        testResult={ghResult}
        baseUrlPlaceholder="https://api.github.com"
      />

      <ProviderCard
        title="GitLab"
        icon="🦊"
        config={gitlab}
        onChange={(c) => setGitlab(c as GitLabConfig)}
        onTest={testGitlab}
        testing={glTesting}
        testResult={glResult}
        baseUrlPlaceholder="https://gitlab.com"
      />

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 rounded-lg text-sm font-semibold text-white transition-colors"
        >
          {saving ? t('common.saving') : saved ? t('common.saved') : t('gitTab.saveChanges')}
        </button>
      </div>

      <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 text-sm text-amber-300">
        <div className="font-semibold mb-1">{t('gitTab.permissionsTitle')}</div>
        <ul className="space-y-0.5 text-amber-400/80 list-disc list-inside">
          <li>{t('gitTab.permissionsGH')}</li>
          <li>{t('gitTab.permissionsGL')}</li>
        </ul>
      </div>
    </div>
  )
}
