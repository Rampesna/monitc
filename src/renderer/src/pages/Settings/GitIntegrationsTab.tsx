import { useState, useEffect, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Github, Gitlab, KeyRound, LoaderCircle, ShieldCheck } from 'lucide-react'
import type { GitHubConfig, GitLabConfig } from '../../lib/types'
import { Button } from '../../components/common/Button'
import { Switch } from '../../components/common/Switch'

interface ProviderCardProps {
  title: string
  icon: ReactNode
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
    <div className={`integration-card git-provider-card rounded-xl p-5 space-y-4 ${config.enabled ? 'is-enabled' : ''}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="provider-icon">{icon}</span>
          <h3 className="font-semibold text-slate-100">{title}</h3>
        </div>
        <div className="integration-switch-wrap">
          <span>{config.enabled ? 'On' : 'Off'}</span>
          <Switch checked={config.enabled} onChange={(enabled) => onChange({ ...config, enabled })} label={`${title} ${config.enabled ? 'on' : 'off'}`} />
        </div>
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
            <Button
              variant="secondary"
              size="sm"
              onClick={onTest}
              disabled={testing || !config.pat}
              icon={testing ? <LoaderCircle size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
            >
              {t('gitTab.testConnection')}
            </Button>
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
        icon={<Github size={17} />}
        config={github}
        onChange={(c) => setGithub(c as GitHubConfig)}
        onTest={testGithub}
        testing={ghTesting}
        testResult={ghResult}
        baseUrlPlaceholder="https://api.github.com"
      />

      <ProviderCard
        title="GitLab"
        icon={<Gitlab size={17} />}
        config={gitlab}
        onChange={(c) => setGitlab(c as GitLabConfig)}
        onTest={testGitlab}
        testing={glTesting}
        testResult={glResult}
        baseUrlPlaceholder="https://gitlab.com"
      />

      <div className="flex justify-end">
        <Button variant="primary" onClick={handleSave} disabled={saving} loading={saving} icon={<KeyRound size={13} />}>
          {saving ? t('common.saving') : saved ? t('common.saved') : t('gitTab.saveChanges')}
        </Button>
      </div>

      <div className="integration-permissions rounded-xl p-4 text-sm text-amber-300">
        <div className="font-semibold mb-1 flex items-center gap-2"><ShieldCheck size={14} />{t('gitTab.permissionsTitle')}</div>
        <ul className="space-y-0.5 text-amber-400/80 list-disc list-inside">
          <li>{t('gitTab.permissionsGH')}</li>
          <li>{t('gitTab.permissionsGL')}</li>
        </ul>
      </div>
    </div>
  )
}
