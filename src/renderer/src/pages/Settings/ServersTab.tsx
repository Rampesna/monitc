import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2, Edit2, CheckCircle, XCircle, Server, Wifi } from 'lucide-react'
import { Card } from '../../components/common/Card'
import { Button } from '../../components/common/Button'
import { Modal } from '../../components/common/Modal'
import { useApp } from '../../context/AppContext'
import { StatusDot } from '../../components/common/StatusDot'
import type { Server as ServerType } from '../../lib/types'

const EMPTY: Omit<ServerType, 'id'> = {
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

export function ServersTab(): React.ReactElement {
  const { t } = useTranslation()
  const { state, refreshServers } = useApp()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<ServerType | null>(null)
  const [form, setForm] = useState({ ...EMPTY })
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string; latency?: number } | null>(null)

  const openAdd = (): void => {
    setEditing(null)
    setForm({ ...EMPTY })
    setTestResult(null)
    setModalOpen(true)
  }

  const openEdit = (server: ServerType): void => {
    setEditing(server)
    setForm({ name: server.name, host: server.host, port: server.port, username: server.username, authType: server.authType, password: server.password ?? '', privateKey: server.privateKey ?? '', passphrase: server.passphrase ?? '', isDefault: server.isDefault })
    setTestResult(null)
    setModalOpen(true)
  }

  const handleSave = async (): Promise<void> => {
    if (!form.name || !form.host || !form.username) return
    setSaving(true)
    try {
      let saved: { id: string }
      if (editing) {
        saved = await window.monitcAPI.servers.update({ ...editing, ...form }) as { id: string }
        await window.monitcAPI.monitor.stop(editing.id).catch(() => {})
      } else {
        saved = await window.monitcAPI.servers.add(form) as { id: string }
      }
      await refreshServers()
      window.monitcAPI.monitor.start(saved.id).catch(console.error)
      setModalOpen(false)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string, name: string): Promise<void> => {
    if (!confirm(t('serversTab.deleteConfirm', { name }))) return
    await window.monitcAPI.servers.remove(id)
    await refreshServers()
  }

  const handleTest = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.monitcAPI.servers.testConnection(form as ServerType)
      setTestResult(result)
    } finally {
      setTesting(false)
    }
  }

  const f = (field: keyof typeof EMPTY, value: string | number | boolean): void => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Server size={16} className="text-indigo-400" />
          <h2 className="text-base font-semibold text-slate-100">{t('serversTab.title')}</h2>
        </div>
        <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={openAdd}>{t('serversTab.addServer')}</Button>
      </div>

      {state.servers.length === 0 ? (
        <Card className="text-center py-10">
          <Server size={28} className="text-slate-600 mx-auto mb-2" />
          <p className="text-slate-500 text-sm">{t('serversTab.noServers')}</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {state.servers.map((server) => (
            <Card key={server.id} className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-indigo-600/20 flex items-center justify-center">
                  <Server size={14} className="text-indigo-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-200">{server.name}</p>
                  <p className="text-xs text-slate-500">{server.username}@{server.host}:{server.port} · {server.authType}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <StatusDot status={state.connectionStatuses[server.id] ?? 'disconnected'} showLabel />
                <button onClick={() => openEdit(server)} className="p-1.5 rounded-lg hover:bg-white/5 text-slate-400 hover:text-slate-200">
                  <Edit2 size={13} />
                </button>
                <button onClick={() => handleDelete(server.id, server.name)} className="p-1.5 rounded-lg hover:bg-red-500/20 text-slate-400 hover:text-red-400">
                  <Trash2 size={13} />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? t('serversTab.editServer') : t('serversTab.addServer')}
        size="lg"
        footer={
          <div className="flex gap-2 justify-between">
            <Button variant="ghost" size="sm" icon={<Wifi size={13} />} loading={testing} onClick={handleTest}>
              {t('serversTab.testConnection')}
            </Button>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setModalOpen(false)}>{t('common.cancel')}</Button>
              <Button variant="primary" loading={saving} onClick={handleSave}>{t('common.save')}</Button>
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
            <div>
              <label className="text-xs text-slate-400 mb-1 block">{t('serversTab.serverName')}</label>
              <input value={form.name} onChange={(e) => f('name', e.target.value)} placeholder="Production Server"
                className="w-full bg-[#0d0d14] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">{t('serversTab.host')}</label>
              <input value={form.host} onChange={(e) => f('host', e.target.value)} placeholder="192.168.1.100"
                className="w-full bg-[#0d0d14] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 mb-1 block">{t('serversTab.port')}</label>
              <input type="number" value={form.port} onChange={(e) => f('port', Number(e.target.value))}
                className="w-full bg-[#0d0d14] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">{t('serversTab.username')}</label>
              <input value={form.username} onChange={(e) => f('username', e.target.value)} placeholder="root"
                className="w-full bg-[#0d0d14] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500" />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">{t('serversTab.authMethod')}</label>
            <div className="flex gap-2">
              {(['password', 'privateKey'] as const).map((authOpt) => (
                <button key={authOpt} onClick={() => f('authType', authOpt)}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-colors ${form.authType === authOpt ? 'bg-indigo-600/20 border-indigo-500/30 text-indigo-300' : 'bg-[#0d0d14] border-[#1e1e2e] text-slate-400'}`}>
                  {authOpt === 'password' ? t('serversTab.authPassword') : t('serversTab.authKey')}
                </button>
              ))}
            </div>
          </div>
          {form.authType === 'password' ? (
            <div>
              <label className="text-xs text-slate-400 mb-1 block">{t('serversTab.password')}</label>
              <input type="password" value={form.password} onChange={(e) => f('password', e.target.value)}
                className="w-full bg-[#0d0d14] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500" />
            </div>
          ) : (
            <>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">{t('serversTab.privateKey')}</label>
                <textarea value={form.privateKey} onChange={(e) => f('privateKey', e.target.value)} rows={4}
                  placeholder="-----BEGIN RSA PRIVATE KEY-----..."
                  className="w-full bg-[#0d0d14] border border-[#1e1e2e] rounded-lg px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500 resize-none" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">{t('serversTab.privateKeyPath')} ({t('common.optional')})</label>
                <input type="password" value={form.passphrase} onChange={(e) => f('passphrase', e.target.value)}
                  className="w-full bg-[#0d0d14] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500" />
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  )
}
