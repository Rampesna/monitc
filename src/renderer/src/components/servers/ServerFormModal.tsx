import React, { useEffect, useState } from 'react'
import { CheckCircle, Wifi, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useApp } from '../../context/AppContext'
import type { Server } from '../../lib/types'
import { Button } from '../common/Button'
import { Modal } from '../common/Modal'

const EMPTY: Omit<Server, 'id'> = {
  name: '',
  host: '',
  port: 22,
  username: '',
  authType: 'password',
  password: '',
  privateKey: '',
  passphrase: '',
  isDefault: false
}

interface ServerFormModalProps {
  open: boolean
  server?: Server | null
  onClose: () => void
  onSaved?: (server: Server) => void
}

export function ServerFormModal({ open, server, onClose, onSaved }: ServerFormModalProps): React.ReactElement {
  const { t } = useTranslation()
  const { refreshServers } = useApp()
  const [form, setForm] = useState({ ...EMPTY })
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string; latency?: number } | null>(null)

  useEffect(() => {
    if (!open) return
    setForm(server ? {
      name: server.name,
      host: server.host,
      port: server.port,
      username: server.username,
      authType: server.authType,
      password: server.password ?? '',
      privateKey: server.privateKey ?? '',
      passphrase: server.passphrase ?? '',
      isDefault: server.isDefault
    } : { ...EMPTY })
    setTestResult(null)
  }, [open, server])

  const setField = (field: keyof typeof EMPTY, value: string | number | boolean): void => {
    setForm((previous) => ({ ...previous, [field]: value }))
  }

  const handleSave = async (): Promise<void> => {
    if (!form.name.trim() || !form.host.trim() || !form.username.trim()) return
    setSaving(true)
    try {
      const saved = (server
        ? await window.monitcAPI.servers.update({ ...server, ...form })
        : await window.monitcAPI.servers.add(form)) as Server
      if (server) await window.monitcAPI.monitor.stop(server.id).catch(() => {})
      await refreshServers()
      window.monitcAPI.monitor.start(saved.id).catch(console.error)
      onSaved?.(saved)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    try {
      setTestResult(await window.monitcAPI.servers.testConnection({ ...form, id: server?.id ?? 'connection-test' }))
    } finally {
      setTesting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={server ? t('serversTab.editServer') : t('serversTab.addServer')}
      size="lg"
      footer={
        <div className="flex gap-2 justify-between">
          <Button variant="ghost" size="sm" icon={<Wifi size={13} />} loading={testing} onClick={handleTest}>
            {t('serversTab.testConnection')}
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
            <Button variant="primary" loading={saving} disabled={!form.name || !form.host || !form.username} onClick={handleSave}>{t('common.save')}</Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        {testResult && (
          <div className={`flex items-center gap-2 p-2 rounded-lg text-xs ${testResult.success ? 'bg-green-500/10 border border-green-500/20 text-green-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'}`}>
            {testResult.success ? <CheckCircle size={12} /> : <XCircle size={12} />}
            {testResult.success ? `${t('serversTab.testSuccess')} — ${testResult.latency}ms` : `${t('common.error')}: ${testResult.error}`}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-slate-400">{t('serversTab.serverName')}
            <input value={form.name} onChange={(event) => setField('name', event.target.value)} placeholder="Production Server" className="mt-1 w-full bg-[#0d0d14] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500" />
          </label>
          <label className="text-xs text-slate-400">{t('serversTab.host')}
            <input value={form.host} onChange={(event) => setField('host', event.target.value)} placeholder="192.168.1.100" className="mt-1 w-full bg-[#0d0d14] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500" />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-slate-400">{t('serversTab.port')}
            <input type="number" min={1} max={65535} value={form.port} onChange={(event) => setField('port', Number(event.target.value))} className="mt-1 w-full bg-[#0d0d14] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500" />
          </label>
          <label className="text-xs text-slate-400">{t('serversTab.username')}
            <input value={form.username} onChange={(event) => setField('username', event.target.value)} placeholder="root" className="mt-1 w-full bg-[#0d0d14] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500" />
          </label>
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1 block">{t('serversTab.authMethod')}</label>
          <div className="flex gap-2">
            {(['password', 'privateKey'] as const).map((option) => (
              <button key={option} type="button" onClick={() => setField('authType', option)} className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-colors ${form.authType === option ? 'bg-indigo-600/20 border-indigo-500/30 text-indigo-300' : 'bg-[#0d0d14] border-[#1e1e2e] text-slate-400'}`}>
                {option === 'password' ? t('serversTab.authPassword') : t('serversTab.authKey')}
              </button>
            ))}
          </div>
        </div>
        {form.authType === 'password' ? (
          <label className="text-xs text-slate-400 block">{t('serversTab.password')}
            <input type="password" value={form.password} onChange={(event) => setField('password', event.target.value)} className="mt-1 w-full bg-[#0d0d14] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500" />
          </label>
        ) : (
          <>
            <label className="text-xs text-slate-400 block">{t('serversTab.privateKey')}
              <textarea value={form.privateKey} onChange={(event) => setField('privateKey', event.target.value)} rows={4} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----..." className="mt-1 w-full bg-[#0d0d14] border border-[#1e1e2e] rounded-lg px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500 resize-none" />
            </label>
            <label className="text-xs text-slate-400 block">{t('serversTab.passphrase')} ({t('common.optional')})
              <input type="password" value={form.passphrase} onChange={(event) => setField('passphrase', event.target.value)} className="mt-1 w-full bg-[#0d0d14] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500" />
            </label>
          </>
        )}
      </div>
    </Modal>
  )
}
