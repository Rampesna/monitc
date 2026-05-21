import React, { useState } from 'react'
import { Activity, Copy, Check, ShieldCheck, AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/common/Button'

interface LicenseGateProps {
  licenseKey: string
  isNew: boolean
  onContinue: () => void
}

export function LicenseGate({ licenseKey, isNew, onContinue }: LicenseGateProps): React.ReactElement {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const [inputKey, setInputKey] = useState('')
  const [error, setError] = useState('')

  const handleCopy = (): void => {
    navigator.clipboard.writeText(licenseKey).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const handleVerify = (): void => {
    if (inputKey.trim() === licenseKey) {
      setError('')
      onContinue()
    } else {
      setError(t('license.verifyError'))
    }
  }

  if (isNew) {
    return (
      <div className="fixed inset-0 bg-[#0a0a0f] flex items-center justify-center">
        <div className="max-w-lg w-full mx-6 text-center">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
              <Activity size={32} className="text-indigo-400" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-slate-100 mb-2">{t('license.title')}</h1>
          <p className="text-slate-400 mb-8 text-sm">{t('license.subtitle')}</p>

          <div className="bg-[#12121a] border border-[#2d2d45] rounded-xl p-6 mb-6">
            <div className="flex items-center gap-2 mb-3">
              <ShieldCheck size={14} className="text-indigo-400" />
              <span className="text-xs text-slate-400 font-medium">{t('license.keyLabel')}</span>
            </div>
            <div className="font-mono text-xl font-bold text-indigo-300 tracking-widest mb-4 break-all">
              {licenseKey}
            </div>
            <button
              onClick={handleCopy}
              className="flex items-center gap-2 mx-auto px-4 py-2 bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 rounded-lg text-indigo-300 text-sm font-medium transition-colors"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? t('common.copied') : t('common.copy')}
            </button>
          </div>

          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 mb-6 flex items-start gap-3 text-left">
            <AlertTriangle size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-amber-300 text-sm font-medium mb-1">{t('common.warning')}</p>
              <p className="text-amber-400/70 text-xs leading-relaxed">
                {t('license.keyWarning')}
              </p>
            </div>
          </div>

          <Button variant="primary" size="lg" onClick={() => { window.monitcAPI.app.confirmLicense().catch(console.error); onContinue() }} className="w-full">
            {t('license.confirmButton')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-[#0a0a0f] flex items-center justify-center">
      <div className="max-w-md w-full mx-6 text-center">
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
            <Activity size={32} className="text-indigo-400" />
          </div>
        </div>
        <h1 className="text-2xl font-bold text-slate-100 mb-2">{t('license.verifyTitle')}</h1>
        <p className="text-slate-400 mb-8 text-sm">{t('license.verifySubtitle')}</p>

        <div className="bg-[#12121a] border border-[#2d2d45] rounded-xl p-6 mb-4">
          <input
            type="text"
            value={inputKey}
            onChange={(e) => setInputKey(e.target.value.toUpperCase())}
            placeholder={t('license.verifyPlaceholder')}
            className="w-full bg-[#0d0d14] border border-[#1e1e2e] rounded-lg px-4 py-3 text-center font-mono text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500 tracking-widest"
            onKeyDown={(e) => { if (e.key === 'Enter') handleVerify() }}
          />
          {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
        </div>

        <Button variant="primary" size="lg" onClick={handleVerify} className="w-full">
          {t('license.verifyButton')}
        </Button>
      </div>
    </div>
  )
}
