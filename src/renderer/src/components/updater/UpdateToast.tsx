import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, RefreshCw, AlertCircle, Sparkles, Loader2 } from 'lucide-react'
import { useAppUpdater } from '../../hooks/useAppUpdater'
import { Button } from '../common/Button'

export function UpdateToast(): React.ReactElement | null {
  const { t } = useTranslation()
  const { state, visible, check, download, install } = useAppUpdater()
  const [snoozed, setSnoozed] = useState(false)

  if (!visible || snoozed) return null

  const isMac = window.monitcAPI.app.platform === 'darwin'

  const title = (() => {
    switch (state.status) {
      case 'available':
        return t('updater.availableTitle', { version: state.version })
      case 'downloading':
        return t('updater.downloadingTitle', { version: state.version })
      case 'ready':
        return t('updater.readyTitle', { version: state.version })
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
      case 'error':
        return state.message ?? t('updater.errorDesc')
      default:
        return ''
    }
  })()

  const handlePrimary = async (): Promise<void> => {
    if (state.status === 'available') await download()
    else if (state.status === 'ready') await install()
    else if (state.status === 'error') await check()
  }

  const primaryLabel = (() => {
    if (state.status === 'ready') return t('updater.restart')
    if (state.status === 'error') return t('updater.retry')
    if (state.status === 'downloading') return t('updater.downloading')
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
              {state.status === 'downloading' ? (
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

          <div className="flex items-center gap-2">
            {state.status !== 'downloading' && (
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
