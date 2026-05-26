import React, { useState, useEffect } from 'react'
import { Bell, Plus, Trash2, Edit2, AlertTriangle, CheckCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Card } from '../components/common/Card'
import { Button } from '../components/common/Button'
import { Badge } from '../components/common/Badge'
import { Modal } from '../components/common/Modal'
import { useApp } from '../context/AppContext'
import { getMetricLabel, formatDate } from '../lib/format'
import { METRIC_TYPES, OPERATOR_LABELS, isEventMetric } from '../lib/constants'
import type { AlertRule, MetricType } from '../lib/types'

const EMPTY_RULE: Omit<AlertRule, 'id' | 'lastTriggeredAt' | 'consecutiveBreaches'> = {
  name: '',
  serverId: '',
  metric: 'cpu_percent',
  operator: 'gt',
  threshold: 80,
  durationSeconds: 30,
  channels: ['smtp'],
  recipients: [],
  cooldownMinutes: 15,
  enabled: true
}

export function AlertsPage(): React.ReactElement {
  const { t } = useTranslation()
  const { state } = useApp()
  const [rules, setRules] = useState<AlertRule[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<AlertRule | null>(null)
  const [form, setForm] = useState({ ...EMPTY_RULE })
  const [recipientInput, setRecipientInput] = useState('')
  const [saving, setSaving] = useState(false)

  const loadRules = (): void => {
    window.monitcAPI.alerts.list().then((r) => setRules(r as AlertRule[])).catch(console.error)
  }

  useEffect(() => { loadRules() }, [])

  const openAdd = (): void => {
    setEditing(null)
    setForm({ ...EMPTY_RULE, serverId: state.servers[0]?.id ?? '' })
    setRecipientInput('')
    setModalOpen(true)
  }

  const openEdit = (rule: AlertRule): void => {
    setEditing(rule)
    setForm({ name: rule.name, serverId: rule.serverId, metric: rule.metric, operator: rule.operator, threshold: rule.threshold, durationSeconds: rule.durationSeconds, channels: rule.channels, recipients: rule.recipients, cooldownMinutes: rule.cooldownMinutes, enabled: rule.enabled })
    setRecipientInput(rule.recipients.join(', '))
    setModalOpen(true)
  }

  const handleSave = async (): Promise<void> => {
    if (!form.name || !form.serverId) return
    setSaving(true)
    const recipients = recipientInput.split(',').map((r) => r.trim()).filter(Boolean)
    try {
      if (editing) {
        await window.monitcAPI.alerts.update({ ...editing, ...form, recipients })
      } else {
        await window.monitcAPI.alerts.add({ ...form, recipients })
      }
      loadRules()
      setModalOpen(false)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string): Promise<void> => {
    if (!confirm(t('alerts.deleteConfirm'))) return
    await window.monitcAPI.alerts.remove(id)
    loadRules()
  }

  const handleToggle = async (rule: AlertRule): Promise<void> => {
    await window.monitcAPI.alerts.update({ ...rule, enabled: !rule.enabled })
    loadRules()
  }

  const toggleChannel = (ch: 'smtp' | 'whatsapp' | 'telegram'): void => {
    setForm((f) => ({
      ...f,
      channels: f.channels.includes(ch) ? f.channels.filter((c) => c !== ch) : [...f.channels, ch]
    }))
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bell size={20} className="text-amber-400" />
          <h1 className="text-lg font-semibold text-slate-100">{t('alerts.title')}</h1>
          {state.recentAlerts.length > 0 && (
            <Badge variant="danger">{state.recentAlerts.length}</Badge>
          )}
        </div>
        <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={openAdd}>{t('alerts.addRule')}</Button>
      </div>

      {state.recentAlerts.length > 0 && (
        <Card>
          <h2 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">
            <AlertTriangle size={14} className="text-red-400" /> {t('alerts.history')}
          </h2>
          <div className="space-y-2">
            {state.recentAlerts.slice(0, 5).map((a, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-[#1e1e2e] last:border-0 text-xs">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={12} className="text-red-400" />
                  <span className="text-slate-200 font-medium">{a.ruleName}</span>
                  <span className="text-slate-500">
                    {isEventMetric(a.metric)
                      ? t('alerts.connectionLostTriggered')
                      : `${getMetricLabel(a.metric)}: ${a.value.toFixed(1)} > ${a.threshold}`}
                  </span>
                </div>
                <span className="text-slate-500">{formatDate(a.timestamp)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {rules.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <Bell size={32} className="text-slate-600" />
          <p className="text-slate-500 text-sm">{t('alerts.noRules')}</p>
          <Button variant="primary" icon={<Plus size={14} />} onClick={openAdd}>{t('alerts.addRule')}</Button>
        </div>
      ) : (
        <Card padding="none">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#1e1e2e]">
                  {[t('common.name'), t('settings.servers'), t('alerts.metric'), t('alerts.operator'), t('alerts.channels'), t('alerts.lastTriggered'), t('common.status'), ''].map((h) => (
                    <th key={h} className="text-left py-2 px-4 text-slate-500 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => {
                  const server = state.servers.find((s) => s.id === rule.serverId)
                  return (
                    <tr key={rule.id} className="border-b border-[#1e1e2e]/50 hover:bg-[#1a1a25] transition-colors">
                      <td className="py-2 px-4 font-medium text-slate-200">{rule.name}</td>
                      <td className="py-2 px-4 text-slate-400">{server?.name ?? '-'}</td>
                      <td className="py-2 px-4 text-slate-300">{getMetricLabel(rule.metric)}</td>
                      <td className="py-2 px-4 text-slate-400">
                        {isEventMetric(rule.metric)
                          ? t('alerts.connectionLostCondition', { seconds: rule.durationSeconds })
                          : `${OPERATOR_LABELS[rule.operator]} ${rule.threshold}`}
                      </td>
                      <td className="py-2 px-4">
                        <div className="flex gap-1">
                          {rule.channels.map((ch) => <Badge key={ch} variant="info">{ch}</Badge>)}
                        </div>
                      </td>
                      <td className="py-2 px-4 text-slate-500">{rule.lastTriggeredAt ? formatDate(rule.lastTriggeredAt) : t('alerts.never')}</td>
                      <td className="py-2 px-4">
                        <button onClick={() => handleToggle(rule)} className="flex items-center gap-1.5">
                          {rule.enabled ? (
                            <Badge variant="success"><CheckCircle size={9} className="inline mr-0.5" />{t('alerts.enabled')}</Badge>
                          ) : (
                            <Badge variant="default">Disabled</Badge>
                          )}
                        </button>
                      </td>
                      <td className="py-2 px-4">
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => openEdit(rule)} className="p-1 rounded hover:bg-white/5 text-slate-400 hover:text-slate-200">
                            <Edit2 size={12} />
                          </button>
                          <button onClick={() => handleDelete(rule.id)} className="p-1 rounded hover:bg-red-500/20 text-slate-400 hover:text-red-400">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? t('alerts.editRule') : t('alerts.addRule')}
        size="lg"
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>{t('common.cancel')}</Button>
            <Button variant="primary" loading={saving} onClick={handleSave}>{t('common.save')}</Button>
          </div>
        }
      >
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 mb-1 block">{t('common.name')}</label>
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full bg-[#0d0d14] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500" placeholder="CPU Critical Alert" />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">{t('settings.servers')}</label>
              <select value={form.serverId} onChange={(e) => setForm((f) => ({ ...f, serverId: e.target.value }))}
                className="w-full bg-[#0d0d14] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500">
                {state.servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">{t('alerts.metric')}</label>
            <select
              value={form.metric}
              onChange={(e) => {
                const metric = e.target.value as MetricType
                setForm((f) => ({
                  ...f,
                  metric,
                  ...(isEventMetric(metric) ? { operator: 'gt' as const, threshold: 0, durationSeconds: 30 } : {})
                }))
              }}
              className="w-full bg-[#0d0d14] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500">
              {METRIC_TYPES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            {isEventMetric(form.metric) && (
              <p className="text-xs text-slate-500 mt-1">{t('alerts.connectionLostHint')}</p>
            )}
          </div>
          {isEventMetric(form.metric) ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">{t('alerts.connectionLostDelay')}</label>
                <input type="number" value={form.durationSeconds} onChange={(e) => setForm((f) => ({ ...f, durationSeconds: Number(e.target.value) }))}
                  className="w-full bg-[#0d0d14] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">{t('alerts.cooldown')}</label>
                <input type="number" value={form.cooldownMinutes} onChange={(e) => setForm((f) => ({ ...f, cooldownMinutes: Number(e.target.value) }))}
                  className="w-full bg-[#0d0d14] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500" />
              </div>
            </div>
          ) : (
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-slate-400 mb-1 block">{t('alerts.operator')}</label>
              <select value={form.operator} onChange={(e) => setForm((f) => ({ ...f, operator: e.target.value as AlertRule['operator'] }))}
                className="w-full bg-[#0d0d14] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500">
                <option value="gt">greater than (&gt;)</option>
                <option value="lt">less than (&lt;)</option>
                <option value="eq">equals (=)</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">{t('alerts.threshold')}</label>
              <input type="number" value={form.threshold} onChange={(e) => setForm((f) => ({ ...f, threshold: Number(e.target.value) }))}
                className="w-full bg-[#0d0d14] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">{t('alerts.duration')}</label>
              <input type="number" value={form.durationSeconds} onChange={(e) => setForm((f) => ({ ...f, durationSeconds: Number(e.target.value) }))}
                className="w-full bg-[#0d0d14] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500" />
            </div>
          </div>
          )}
          <div>
            <label className="text-xs text-slate-400 mb-1 block">{t('alerts.channels')}</label>
            <div className="flex gap-3">
              {(['smtp', 'whatsapp', 'telegram'] as const).map((ch) => (
                <label key={ch} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.channels.includes(ch)} onChange={() => toggleChannel(ch)}
                    className="rounded border-[#2d2d45] bg-[#0d0d14]" />
                  <span className="text-xs text-slate-300 capitalize">{ch}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Recipients (comma separated)</label>
            <input value={recipientInput} onChange={(e) => setRecipientInput(e.target.value)}
              placeholder="user@example.com, +905551234567"
              className="w-full bg-[#0d0d14] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500" />
          </div>
          {!isEventMetric(form.metric) && (
          <div>
            <label className="text-xs text-slate-400 mb-1 block">{t('alerts.cooldown')}</label>
            <input type="number" value={form.cooldownMinutes} onChange={(e) => setForm((f) => ({ ...f, cooldownMinutes: Number(e.target.value) }))}
              className="w-32 bg-[#0d0d14] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500" />
          </div>
          )}
        </div>
      </Modal>
    </div>
  )
}
