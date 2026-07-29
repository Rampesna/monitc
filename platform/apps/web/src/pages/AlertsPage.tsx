import { useEffect, useState, type FormEvent } from 'react'
import { Bell, Check, Clock3, Mail, Plus, ShieldAlert, Trash2 } from 'lucide-react'
import { Link } from 'react-router'
import { Modal } from '../components/Modal'
import { PageSkeleton } from '../components/Skeleton'
import { useAuth } from '../context'
import { api, jsonBody } from '../lib/api'

type Metric = 'cpu' | 'memory' | 'disk' | 'network_rx' | 'network_tx'

interface AlertRule {
  id: string
  name: string
  metric: Metric
  operator: string
  threshold: number
  durationSeconds: number
  cooldownSeconds: number
  enabled: boolean
}

interface AlertEvent {
  id: string
  ruleName: string
  value: number
  status: 'open' | 'resolved'
  triggeredAt: string
}

const templates: Array<{ name: string; metric: Metric; threshold: number; durationSeconds: number }> = [
  { name: 'CPU pressure', metric: 'cpu', threshold: 90, durationSeconds: 300 },
  { name: 'Memory pressure', metric: 'memory', threshold: 90, durationSeconds: 300 },
  { name: 'Disk capacity', metric: 'disk', threshold: 85, durationSeconds: 60 }
]

export function AlertsPage() {
  const { workspace } = useAuth()
  const [rules, setRules] = useState<AlertRule[]>([])
  const [events, setEvents] = useState<AlertEvent[]>([])
  const [enabledByPlan, setEnabledByPlan] = useState(Boolean(workspace?.plan.entitlements.alerts))
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    name: '',
    metric: 'cpu' as Metric,
    threshold: 90,
    durationSeconds: 300,
    cooldownSeconds: 900
  })

  const load = async () => {
    const [ruleData, eventData] = await Promise.all([
      api<{ enabledByPlan: boolean; rules: AlertRule[] }>('/api/v1/alerts/rules'),
      api<{ events: AlertEvent[] }>('/api/v1/alerts/events')
    ])
    setEnabledByPlan(ruleData.enabledByPlan)
    setRules(ruleData.rules)
    setEvents(eventData.events)
  }
  useEffect(() => { void load().finally(() => setLoading(false)) }, [])

  const create = async (input = form) => {
    setBusy(true)
    setError('')
    try {
      const rule = await api<AlertRule>('/api/v1/alerts/rules', {
        method: 'POST',
        ...jsonBody({ ...input, operator: 'gte', enabled: true })
      })
      setRules((current) => [rule, ...current])
      setCreating(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Alert rule could not be created.')
    } finally {
      setBusy(false)
    }
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    void create()
  }
  const toggle = async (rule: AlertRule) => {
    const updated = await api<AlertRule>(`/api/v1/alerts/rules/${rule.id}`, {
      method: 'PATCH',
      ...jsonBody({ enabled: !rule.enabled })
    })
    setRules((current) => current.map((item) => item.id === rule.id ? updated : item))
  }
  const remove = async (rule: AlertRule) => {
    if (!window.confirm(`Delete “${rule.name}”?`)) return
    await api(`/api/v1/alerts/rules/${rule.id}`, { method: 'DELETE' })
    setRules((current) => current.filter((item) => item.id !== rule.id))
  }

  if (loading) return <PageSkeleton />
  return (
    <div className="page alerts-page">
      <div className="page-title"><div><p className="eyebrow">SIGNAL ROUTING</p><h1>Alerts</h1><p>Sustained-threshold rules evaluated by the collector, with cooldown and recovery state.</p></div><button className="primary-button" disabled={!enabledByPlan} onClick={() => setCreating(true)}><Plus size={14} /> New rule</button></div>
      {!enabledByPlan && <div className="alert-intro panel upgrade"><span><ShieldAlert size={21} /></span><div><h2>Cloud alerting starts with Solo.</h2><p>Your local desktop rules keep working. Upgrade to evaluate hosted history continuously.</p></div><Link to="/billing">Compare plans</Link></div>}
      <section className="channel-grid"><article><span><Bell size={17} /></span><div><h3>In-app events</h3><p>Open and resolved states are live now.</p></div><span className="status-badge running">Active</span></article><article><span><Mail size={17} /></span><div><h3>Email & webhook</h3><p>Delivery adapters are staged for a later release.</p></div><span className="status-badge pending">Coming next</span></article></section>

      <section className="panel rules-panel">
        <header className="panel-header"><div><h2>Rules</h2><p>{rules.length} policies in this workspace</p></div></header>
        {rules.map((rule) => <div className="alert-rule-row" key={rule.id}><span><Bell size={14} /></span><div><strong>{rule.name}</strong><small>{metricLabel(rule.metric)} {rule.operator} {rule.threshold} · {Math.round(rule.durationSeconds / 60)} min · {Math.round(rule.cooldownSeconds / 60)} min cooldown</small></div><button className={`soft-switch ${rule.enabled ? 'on' : ''}`} onClick={() => void toggle(rule)} aria-label={`Turn ${rule.name} ${rule.enabled ? 'off' : 'on'}`}><i /></button><button className="icon-button danger" onClick={() => void remove(rule)}><Trash2 size={13} /></button></div>)}
        {!rules.length && <div className="small-empty"><Bell size={22} /><h3>No hosted alert rules</h3><p>Use a starter policy or create your own.</p></div>}
      </section>

      <section className="panel alert-template-panel"><header className="panel-header"><div><h2>Starter policies</h2><p>Soft defaults you can tailor after activation.</p></div></header>{templates.map((item) => <div className="template-row" key={item.name}><span><Check size={13} /></span><strong>{item.name} · {item.threshold}% for {Math.round(item.durationSeconds / 60)} min</strong><button disabled={!enabledByPlan || busy} onClick={() => void create({ ...form, ...item })}>Add rule</button></div>)}</section>

      <section className="panel events-panel"><header className="panel-header"><div><h2>Recent events</h2><p>Latest trigger and recovery states</p></div></header>{events.slice(0, 8).map((event) => <div className="alert-event-row" key={event.id}><span className={event.status}><i /></span><div><strong>{event.ruleName}</strong><small>Observed value {event.value.toFixed(2)}</small></div><time><Clock3 size={11} /> {new Date(event.triggeredAt).toLocaleString()}</time></div>)}{!events.length && <div className="small-empty"><Check size={22} /><h3>No alert events</h3><p>Everything is quiet.</p></div>}</section>

      <Modal open={creating} onClose={() => setCreating(false)} title="Create alert rule" subtitle="The condition must remain true for the full duration.">
        <form className="modal-form alert-form" onSubmit={submit}>
          <label><span>Rule name</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Production CPU pressure" /></label>
          <div className="field-row"><label><span>Metric</span><select value={form.metric} onChange={(event) => setForm({ ...form, metric: event.target.value as Metric })}><option value="cpu">CPU %</option><option value="memory">Memory %</option><option value="disk">Disk %</option><option value="network_rx">Network receive B/s</option><option value="network_tx">Network transmit B/s</option></select></label><label><span>Threshold</span><input type="number" min="0" step="0.1" required value={form.threshold} onChange={(event) => setForm({ ...form, threshold: Number(event.target.value) })} /></label></div>
          <div className="field-row"><label><span>Duration (seconds)</span><input type="number" min="0" required value={form.durationSeconds} onChange={(event) => setForm({ ...form, durationSeconds: Number(event.target.value) })} /></label><label><span>Cooldown (seconds)</span><input type="number" min="60" required value={form.cooldownSeconds} onChange={(event) => setForm({ ...form, cooldownSeconds: Number(event.target.value) })} /></label></div>
          {error && <p className="form-error">{error}</p>}
          <footer className="modal-actions"><button type="button" className="secondary-button" onClick={() => setCreating(false)}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? <span className="button-spinner" /> : <><Plus size={14} /> Create rule</>}</button></footer>
        </form>
      </Modal>
    </div>
  )
}

function metricLabel(metric: Metric): string {
  if (metric === 'network_rx') return 'Network receive'
  if (metric === 'network_tx') return 'Network transmit'
  return `${metric.toUpperCase()} %`
}
