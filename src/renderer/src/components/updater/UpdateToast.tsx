import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, RefreshCw, AlertCircle, Sparkles, Loader2, FileText } from 'lucide-react'
import { useAppUpdater } from '../../hooks/useAppUpdater'
import { Button } from '../common/Button'

export function UpdateToast(): React.ReactElement | null {
  const { t } = useTranslation()
  const { state, visible, check, update, install } = useAppUpdater()
  const [snoozed, setSnoozed] = useState(false)

  useEffect(() => {
    setSnoozed(false)
  }, [state.version])

  if (!visible || (snoozed && state.status === 'available')) return null

  const isMac = window.monitcAPI.app.platform === 'darwin'

  const title = (() => {
    switch (state.status) {
      case 'available':
        return t('updater.availableTitle', { version: state.version })
      case 'downloading':
        return t('updater.downloadingTitle', { version: state.version })
      case 'ready':
        return t('updater.readyTitle', { version: state.version })
      case 'installing':
        return t('updater.installingTitle', { version: state.version })
      case 'error':
        return t('updater.errorTitle')
      default:
        return ''
    }
  })()

  const description = (() => {
    switch (state.status) {
      case 'available':
        return t('updater.availableDesc', {
          current: state.currentVersion,
          latest: state.version
        })
      case 'downloading':
        return t('updater.downloadingDesc', { percent: state.percent ?? 0 })
      case 'ready':
        return t('updater.readyDesc')
      case 'installing':
        return t('updater.installingDesc')
      case 'error':
        return state.message ?? t('updater.errorDesc')
      default:
        return ''
    }
  })()

  const handlePrimary = async (): Promise<void> => {
    if (state.status === 'available') await update()
    else if (state.status === 'ready') await install()
    else if (state.status === 'error') await check()
  }

  const primaryLabel = (() => {
    if (state.status === 'ready') return t('updater.restart')
    if (state.status === 'error') return t('updater.retry')
    if (state.status === 'downloading') return t('updater.downloading')
    if (state.status === 'installing') return t('updater.installing')
    return t('updater.updateNow')
  })()

  return (
    <div
      className={`fixed z-[200] w-[min(360px,calc(100vw-24px))] no-drag ${isMac ? 'top-3 right-3' : 'top-3 right-3'}`}
      role="status"
      aria-live="polite"
    >
      <div className="rounded-xl border border-indigo-500/30 bg-[#12121a]/95 backdrop-blur-md shadow-2xl shadow-indigo-500/10 overflow-hidden">
        <div className="h-0.5 bg-gradient-to-r from-indigo-600 via-violet-500 to-indigo-600" />
        <div className="p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-indigo-500/15 border border-indigo-500/25 flex items-center justify-center">
              {state.status === 'downloading' || state.status === 'installing' ? (
                <Loader2 size={16} className="text-indigo-400 animate-spin" />
              ) : state.status === 'error' ? (
                <AlertCircle size={16} className="text-red-400" />
              ) : (
                <Sparkles size={16} className="text-indigo-400" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-100 leading-snug">{title}</p>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">{description}</p>
              {state.status === 'available' && (
                <p className="text-[10px] text-slate-600 mt-1.5 leading-relaxed">{t('updater.laterHint')}</p>
              )}
            </div>
          </div>

          {state.status === 'downloading' && (
            <div className="h-1.5 rounded-full bg-[#1e1e2e] overflow-hidden">
              <div
                className="h-full bg-indigo-500 transition-all duration-300"
                style={{ width: `${state.percent ?? 0}%` }}
              />
            </div>
          )}

          {state.status === 'available' && state.releaseNotes && (
            <details className="rounded-lg border border-[#2d2d45] bg-[#0d0d14]/70 px-3 py-2">
              <summary className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer select-none">
                <FileText size={12} className="text-indigo-400" />
                {t('updater.releaseNotes')}
              </summary>
              <div className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-slate-400">
                {state.releaseNotes}
              </div>
            </details>
          )}

          <div className="flex items-center gap-2">
            {state.status !== 'downloading' && state.status !== 'installing' && (
              <Button
                variant="primary"
                size="sm"
                icon={state.status === 'ready' ? <RefreshCw size={12} /> : <Download size={12} />}
                onClick={handlePrimary}
              >
                {primaryLabel}
              </Button>
            )}
            {state.status === 'available' && (
              <button
                type="button"
                onClick={() => setSnoozed(true)}
                className="text-xs text-slate-500 hover:text-slate-300 px-2 py-1.5 transition-colors"
              >
                {t('updater.later')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
