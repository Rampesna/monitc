import React, { useRef, useState } from 'react'
import { X, FileImage, FileText, Clock, Loader2, Download, AlertCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '../common/Button'
import { ReportCanvas } from './ReportCanvas'
import { useMetricsHistory } from '../../hooks/useMetricsHistory'
import type { Server } from '../../lib/types'

interface Props {
  server: Server
  onClose: () => void
}

type Format = 'png' | 'pdf'

const HOUR_OPTIONS = [
  { value: 1,   label: 'Last 1 hour'  },
  { value: 6,   label: 'Last 6 hours' },
  { value: 24,  label: 'Last 24 hours' },
  { value: 48,  label: 'Last 48 hours' },
  { value: 168, label: 'Last 7 days'  }
]

export function ExportReportModal({ server, onClose }: Props): React.ReactElement {
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLDivElement>(null)
  const { fetch, state } = useMetricsHistory()

  const [hours,  setHours]  = useState(24)
  const [format, setFormat] = useState<Format>('pdf')
  const [exporting, setExporting] = useState(false)
  const [step, setStep]     = useState<'config' | 'preview'>('config')

  // ── Load history ────────────────────────────────────────────────────────
  const handleLoad = async (): Promise<void> => {
    await fetch(server.id, hours)
    setStep('preview')
  }

  // ── Export ───────────────────────────────────────────────────────────────
  const handleExport = async (): Promise<void> => {
    if (!canvasRef.current) return
    setExporting(true)
    try {
      const html2canvas = (await import('html2canvas')).default
      const canvas = await html2canvas(canvasRef.current, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff'
      })

      const filename = `monitc-${server.name.replace(/\s+/g, '-').toLowerCase()}-${hours}h`

      if (format === 'png') {
        const link = document.createElement('a')
        link.download = `${filename}.png`
        link.href = canvas.toDataURL('image/png')
        link.click()
      } else {
        const { jsPDF } = await import('jspdf')
        const imgData  = canvas.toDataURL('image/png')
        const pxToMm   = (px: number): number => px * 0.264583
        const imgW     = pxToMm(canvas.width)
        const imgH     = pxToMm(canvas.height)

        // A4 landscape if wider, portrait otherwise
        const orientation = imgW > 277 ? 'landscape' : 'portrait'
        const pageW = orientation === 'landscape' ? 297 : 210
        const pageH = orientation === 'landscape' ? 210 : 297

        const pdf = new jsPDF({ orientation, unit: 'mm', format: 'a4' })

        // Scale image to fit page width with top/bottom margins
        const margin  = 10
        const fitW    = pageW - margin * 2
        const fitH    = (imgH / imgW) * fitW

        // If taller than one page, tile across multiple pages
        if (fitH <= pageH - margin * 2) {
          pdf.addImage(imgData, 'PNG', margin, margin, fitW, fitH)
        } else {
          const pageContentH = pageH - margin * 2
          const totalPages   = Math.ceil(fitH / pageContentH)
          for (let i = 0; i < totalPages; i++) {
            if (i > 0) pdf.addPage()
            // Negative y offset on the image to show the correct slice
            pdf.addImage(imgData, 'PNG', margin, margin - i * pageContentH, fitW, fitH)
          }
        }

        pdf.save(`${filename}.pdf`)
      }
    } finally {
      setExporting(false)
    }
  }

  const periodLabel = HOUR_OPTIONS.find((o) => o.value === hours)?.label ?? `${hours}h`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-[#12121a] border border-[#1e1e2e] rounded-2xl shadow-2xl flex flex-col"
           style={{ width: 680, maxHeight: '90vh' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e1e2e]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-indigo-600/20 flex items-center justify-center">
              <Download size={15} className="text-indigo-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-100">
                {t('export.title')}
              </p>
              <p className="text-xs text-slate-500">{server.name} · {server.host}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors">
            <X size={18} />
          </button>
        </div>

        {step === 'config' ? (
          /* ── Config step ──────────────────────────────────────────────── */
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
            {/* Time range */}
            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 mb-3">
                <Clock size={12} />
                {t('export.timeRange')}
              </label>
              <div className="grid grid-cols-5 gap-2">
                {HOUR_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    onClick={() => setHours(o.value)}
                    className={`py-2.5 px-3 rounded-xl text-xs font-semibold border transition-all ${
                      hours === o.value
                        ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-600/20'
                        : 'bg-[#1a1a2e] border-[#1e1e2e] text-slate-400 hover:border-indigo-500/40 hover:text-slate-200'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Format */}
            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 mb-3">
                {t('export.format')}
              </label>
              <div className="grid grid-cols-2 gap-3">
                {([
                  { id: 'pdf' as Format, Icon: FileText,  title: 'PDF',         desc: t('export.pdfDesc')  },
                  { id: 'png' as Format, Icon: FileImage, title: 'PNG Image',   desc: t('export.pngDesc')  }
                ] as { id: Format; Icon: typeof FileText; title: string; desc: string }[]).map(({ id, Icon, title, desc }) => (
                  <button
                    key={id}
                    onClick={() => setFormat(id)}
                    className={`flex items-start gap-3 p-4 rounded-xl border text-left transition-all ${
                      format === id
                        ? 'bg-indigo-600/10 border-indigo-500 text-slate-100'
                        : 'bg-[#1a1a2e] border-[#1e1e2e] text-slate-400 hover:border-indigo-500/30'
                    }`}
                  >
                    <Icon size={18} className={format === id ? 'text-indigo-400 mt-0.5' : 'text-slate-500 mt-0.5'} />
                    <div>
                      <p className="text-sm font-semibold">{title}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{desc}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {state.error && (
              <div className="flex items-center gap-2 text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
                <AlertCircle size={14} />
                {state.error}
              </div>
            )}
          </div>
        ) : (
          /* ── Preview step ─────────────────────────────────────────────── */
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {state.data.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-500">
                <AlertCircle size={32} />
                <p className="text-sm">{t('export.noData')}</p>
                <p className="text-xs text-slate-600">{t('export.noDataHint')}</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>{state.data.length} {t('export.samples')} · {periodLabel}</span>
                  <span className="text-indigo-400">{t('export.previewNote')}</span>
                </div>
                {/* Scale the preview down to fit the modal */}
                <div className="overflow-hidden rounded-xl border border-[#1e1e2e]"
                     style={{ transformOrigin: 'top left' }}>
                  <div style={{ transform: 'scale(0.618)', transformOrigin: 'top left', width: `${100 / 0.618}%`, height: 0, paddingBottom: `${100 / 0.618}%`, overflow: 'visible' }}>
                    <ReportCanvas ref={canvasRef} server={server} history={state.data} hours={hours} />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer actions */}
        <div className="px-6 py-4 border-t border-[#1e1e2e] flex items-center justify-between gap-3">
          <Button variant="ghost" onClick={step === 'preview' ? () => setStep('config') : onClose}>
            {step === 'preview' ? t('common.back') : t('common.cancel')}
          </Button>

          {step === 'config' ? (
            <Button
              variant="primary"
              onClick={handleLoad}
              disabled={state.loading}
              icon={state.loading ? <Loader2 size={14} className="animate-spin" /> : undefined}
            >
              {state.loading ? t('export.loading') : t('export.preview')}
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={handleExport}
              disabled={exporting || state.data.length === 0}
              icon={exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            >
              {exporting ? t('export.exporting') : `${t('export.download')} ${format.toUpperCase()}`}
            </Button>
          )}
        </div>
      </div>

      {/* Off-screen canvas for full-res capture (hidden but rendered in DOM) */}
      {step === 'preview' && state.data.length > 0 && (
        <div style={{ position: 'fixed', top: '-9999px', left: '-9999px', zIndex: -1 }}>
          <ReportCanvas ref={canvasRef} server={server} history={state.data} hours={hours} />
        </div>
      )}
    </div>
  )
}
