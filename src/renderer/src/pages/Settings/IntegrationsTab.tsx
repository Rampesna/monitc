import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Link2, Mail, MessageCircle, Send, CheckCircle, XCircle } from 'lucide-react'
import { Card } from '../../components/common/Card'
import { Button } from '../../components/common/Button'
import type { Integrations, SmtpConfig, WhatsAppConfig, TelegramConfig } from '../../lib/types'

const SMTP_DEFAULT: SmtpConfig = { enabled: false, host: '', port: 587, username: '', password: '', fromAddress: '', secure: false }
const WA_DEFAULT: WhatsAppConfig = { enabled: false, provider: 'twilio', accountSid: '', authToken: '', phoneNumber: '' }
const TG_DEFAULT: TelegramConfig = { enabled: false, botToken: '', chatId: '' }

function TestResult({ result }: { result: { success: boolean; error?: string } | null }): React.ReactElement | null {
  const { t } = useTranslation()
  if (!result) return null
  return (
    <div className={`flex items-center gap-2 text-xs p-2 rounded-lg mt-2 ${result.success ? 'bg-green-500/10 border border-green-500/20 text-green-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'}`}>
      {result.success ? <CheckCircle size={12} /> : <XCircle size={12} />}
      {result.success ? t('integrationsTab.testSuccess') : `${t('common.error')}: ${result.error}`}
    </div>
  )
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div>
      <label className="text-xs text-slate-400 mb-1 block">{label}</label>
      {children}
    </div>
  )
}

const inputCls = "w-full bg-[#0d0d14] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"

export function IntegrationsTab(): React.ReactElement {
  const { t } = useTranslation()
  const [integrations, setIntegrations] = useState<Integrations>({ smtp: null, whatsapp: null, telegram: null })
  const [smtp, setSmtp] = useState<SmtpConfig>(SMTP_DEFAULT)
  const [wa, setWa] = useState<WhatsAppConfig>(WA_DEFAULT)
  const [tg, setTg] = useState<TelegramConfig>(TG_DEFAULT)
  const [saving, setSaving] = useState(false)
  const [smtpTest, setSmtpTest] = useState<{ success: boolean; error?: string } | null>(null)
  const [waTest, setWaTest] = useState<{ success: boolean; error?: string } | null>(null)
  const [tgTest, setTgTest] = useState<{ success: boolean; error?: string } | null>(null)

  useEffect(() => {
    window.monitcAPI.settings.getIntegrations().then((data) => {
      const ints = data as Integrations
      setIntegrations(ints)
      if (ints.smtp) setSmtp(ints.smtp)
      if (ints.whatsapp) setWa(ints.whatsapp)
      if (ints.telegram) setTg(ints.telegram)
    }).catch(console.error)
  }, [])

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    try {
      await window.monitcAPI.settings.saveIntegrations({ smtp: smtp.host ? smtp : null, whatsapp: wa.accountSid ? wa : null, telegram: tg.botToken ? tg : null })
    } finally { setSaving(false) }
  }

  const testSmtp = async (): Promise<void> => {
    setSmtpTest(null)
    const r = await window.monitcAPI.settings.testSmtp(smtp)
    setSmtpTest(r)
  }

  const testWa = async (): Promise<void> => {
    setWaTest(null)
    const r = await window.monitcAPI.settings.testWhatsApp(wa)
    setWaTest(r)
  }

  const testTg = async (): Promise<void> => {
    setTgTest(null)
    const r = await window.monitcAPI.settings.testTelegram(tg)
    setTgTest(r)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link2 size={16} className="text-indigo-400" />
          <h2 className="text-base font-semibold text-slate-100">{t('integrationsTab.title')}</h2>
        </div>
        <Button variant="primary" size="sm" loading={saving} onClick={handleSave}>{t('common.save')}</Button>
      </div>

      <Card className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mail size={14} className="text-blue-400" />
            <h3 className="text-sm font-semibold text-slate-200">{t('integrationsTab.smtp')}</h3>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-xs text-slate-400">{t('common.connected')}</span>
            <input type="checkbox" checked={smtp.enabled} onChange={(e) => setSmtp((s) => ({ ...s, enabled: e.target.checked }))} className="rounded" />
          </label>
        </div>
        {smtp.enabled && (
          <div className="grid grid-cols-2 gap-3">
            <FieldGroup label={t('integrationsTab.smtpHost')}><input value={smtp.host} onChange={(e) => setSmtp((s) => ({ ...s, host: e.target.value }))} className={inputCls} placeholder="smtp.gmail.com" /></FieldGroup>
            <FieldGroup label={t('integrationsTab.smtpPort')}><input type="number" value={smtp.port} onChange={(e) => setSmtp((s) => ({ ...s, port: Number(e.target.value) }))} className={inputCls} /></FieldGroup>
            <FieldGroup label={t('integrationsTab.smtpUser')}><input value={smtp.username} onChange={(e) => setSmtp((s) => ({ ...s, username: e.target.value }))} className={inputCls} /></FieldGroup>
            <FieldGroup label={t('integrationsTab.smtpPass')}><input type="password" value={smtp.password} onChange={(e) => setSmtp((s) => ({ ...s, password: e.target.value }))} className={inputCls} /></FieldGroup>
            <FieldGroup label={t('integrationsTab.smtpFrom')}><input value={smtp.fromAddress} onChange={(e) => setSmtp((s) => ({ ...s, fromAddress: e.target.value }))} className={inputCls} placeholder="monitc@example.com" /></FieldGroup>
            <FieldGroup label={t('integrationsTab.smtpSecure')}>
              <label className="flex items-center gap-2 mt-2">
                <input type="checkbox" checked={smtp.secure} onChange={(e) => setSmtp((s) => ({ ...s, secure: e.target.checked }))} />
                <span className="text-xs text-slate-400">{t('integrationsTab.smtpSecure')}</span>
              </label>
            </FieldGroup>
          </div>
        )}
        {smtp.enabled && (
          <>
            <Button variant="ghost" size="sm" icon={<Send size={12} />} onClick={testSmtp}>{t('integrationsTab.testSend')}</Button>
            <TestResult result={smtpTest} />
          </>
        )}
      </Card>

      <Card className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageCircle size={14} className="text-green-400" />
            <h3 className="text-sm font-semibold text-slate-200">{t('integrationsTab.whatsapp')}</h3>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-xs text-slate-400">{t('common.connected')}</span>
            <input type="checkbox" checked={wa.enabled} onChange={(e) => setWa((w) => ({ ...w, enabled: e.target.checked }))} className="rounded" />
          </label>
        </div>
        {wa.enabled && (
          <div className="grid grid-cols-2 gap-3">
            <FieldGroup label={t('integrationsTab.whatsappProvider')}>
              <select value={wa.provider} onChange={(e) => setWa((w) => ({ ...w, provider: e.target.value as 'twilio' | 'custom' }))} className={inputCls}>
                <option value="twilio">Twilio</option>
                <option value="custom">Custom API</option>
              </select>
            </FieldGroup>
            <FieldGroup label={t('integrationsTab.whatsappFrom')}><input value={wa.phoneNumber} onChange={(e) => setWa((w) => ({ ...w, phoneNumber: e.target.value }))} className={inputCls} placeholder="+905551234567" /></FieldGroup>
            <FieldGroup label={t('integrationsTab.whatsappToken')}><input value={wa.accountSid} onChange={(e) => setWa((w) => ({ ...w, accountSid: e.target.value }))} className={inputCls} /></FieldGroup>
            <FieldGroup label="Auth Token"><input type="password" value={wa.authToken} onChange={(e) => setWa((w) => ({ ...w, authToken: e.target.value }))} className={inputCls} /></FieldGroup>
            {wa.provider === 'custom' && (
              <FieldGroup label={t('integrationsTab.whatsappApiUrl')}><input value={wa.apiUrl ?? ''} onChange={(e) => setWa((w) => ({ ...w, apiUrl: e.target.value }))} className={inputCls} placeholder="https://api.example.com/send" /></FieldGroup>
            )}
          </div>
        )}
        {wa.enabled && (
          <>
            <Button variant="ghost" size="sm" icon={<Send size={12} />} onClick={testWa}>{t('integrationsTab.testSend')}</Button>
            <TestResult result={waTest} />
          </>
        )}
      </Card>

      <Card className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Send size={14} className="text-blue-400" />
            <h3 className="text-sm font-semibold text-slate-200">{t('integrationsTab.telegram')}</h3>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-xs text-slate-400">{t('common.connected')}</span>
            <input type="checkbox" checked={tg.enabled} onChange={(e) => setTg((tgState) => ({ ...tgState, enabled: e.target.checked }))} className="rounded" />
          </label>
        </div>
        {tg.enabled && (
          <div className="grid grid-cols-2 gap-3">
            <FieldGroup label={t('integrationsTab.telegramBotToken')}><input type="password" value={tg.botToken} onChange={(e) => setTg((tgState) => ({ ...tgState, botToken: e.target.value }))} className={inputCls} placeholder="1234567890:ABC..." /></FieldGroup>
            <FieldGroup label={t('integrationsTab.telegramChatId')}><input value={tg.chatId} onChange={(e) => setTg((tgState) => ({ ...tgState, chatId: e.target.value }))} className={inputCls} placeholder="-1001234567890" /></FieldGroup>
          </div>
        )}
        {tg.enabled && (
          <>
            <Button variant="ghost" size="sm" icon={<Send size={12} />} onClick={testTg}>{t('integrationsTab.testSend')}</Button>
            <TestResult result={tgTest} />
          </>
        )}
      </Card>
    </div>
  )
}
