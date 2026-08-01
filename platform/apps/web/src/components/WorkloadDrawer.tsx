import { useEffect, useMemo, useState } from 'react'
import {
  Box,
  Boxes,
  ClipboardCopy,
  Download,
  FileJson2,
  Pause,
  Play,
  RefreshCw,
  RotateCw,
  Search,
  Square,
  TerminalSquare,
  X
} from 'lucide-react'
import type { DockerContainerMetric, PodResourceMetric } from '@monitc/shared'
import { Link } from 'react-router'
import { ApiError, api, jsonBody } from '../lib/api'
import { bytes, millicores, rate } from '../lib/format'
import { useAuth } from '../context'

export interface FleetPod extends PodResourceMetric {
  serverId: string
  serverName: string
}

export interface FleetContainer extends DockerContainerMetric {
  serverId: string
  serverName: string
}

export type SelectedWorkload =
  | { type: 'docker'; item: FleetContainer }
  | { type: 'kubernetes'; item: FleetPod }

interface LogResponse { output: string; fetchedAt: string }

export function WorkloadDrawer({ selected, onClose, onChanged }: {
  selected: SelectedWorkload | null
  onClose(): void
  onChanged(): void
}) {
  const { workspace } = useAuth()
  const [tab, setTab] = useState<'logs' | 'details'>('logs')
  const [content, setContent] = useState('')
  const [query, setQuery] = useState('')
  const [tail, setTail] = useState(500)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [loading, setLoading] = useState(false)
  const [acting, setActing] = useState('')
  const [error, setError] = useState('')
  const [fetchedAt, setFetchedAt] = useState('')

  const logsAllowed = Boolean(workspace?.plan.entitlements.workloadLogs)
  const actionsAllowed = Boolean(workspace?.plan.entitlements.workloadActions)

  const endpoint = useMemo(() => {
    if (!selected) return ''
    if (selected.type === 'docker') {
      return `/api/v1/servers/${selected.item.serverId}/workloads/docker/${encodeURIComponent(selected.item.id)}`
    }
    return `/api/v1/servers/${selected.item.serverId}/workloads/kubernetes/${encodeURIComponent(selected.item.namespace)}/${encodeURIComponent(selected.item.name)}`
  }, [selected])

  const load = async (silent = false) => {
    if (!selected || !logsAllowed) return
    if (!silent) setLoading(true)
    setError('')
    try {
      if (tab === 'logs') {
        const response = await api<LogResponse>(`${endpoint}/logs?tail=${tail}`)
        setContent(response.output || 'No log lines returned.')
        setFetchedAt(response.fetchedAt)
      } else if (selected.type === 'docker') {
        const response = await api<{ details: unknown }>(`${endpoint}/inspect`)
        setContent(JSON.stringify(response.details, null, 2))
        setFetchedAt(new Date().toISOString())
      } else {
        const response = await api<{ output: string }>(`${endpoint}/describe`)
        setContent(response.output)
        setFetchedAt(new Date().toISOString())
      }
    } catch (caught) {
      const message = caught instanceof ApiError && caught.status === 409
        ? 'This server needs an encrypted SSH fallback before remote logs can be opened.'
        : caught instanceof Error ? caught.message : 'Workload details could not be loaded.'
      setError(message)
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    if (!selected) return
    setTab('logs')
    setContent('')
    setQuery('')
    setError('')
    setAutoRefresh(true)
  }, [selected])

  useEffect(() => {
    if (!selected || !logsAllowed) return
    void load()
    if (tab !== 'logs' || !autoRefresh) return
    const timer = window.setInterval(() => void load(true), 4_000)
    return () => window.clearInterval(timer)
  }, [selected, endpoint, tab, tail, autoRefresh, logsAllowed])

  useEffect(() => {
    if (!selected) return
    const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [selected, onClose])

  if (!selected) return null
  const item = selected.item
  const title = item.name
  const subtitle = selected.type === 'docker'
    ? `${selected.item.serverName} · ${selected.item.image}`
    : `${selected.item.serverName} · ${selected.item.namespace}`
  const visibleContent = query
    ? content.split('\n').filter((line) => line.toLowerCase().includes(query.toLowerCase())).join('\n')
    : content

  const runAction = async (action: 'start' | 'stop' | 'restart') => {
    if (!actionsAllowed) return
    const label = selected.type === 'kubernetes' ? 'restart this pod' : `${action} this container`
    if (!window.confirm(`Are you sure you want to ${label}?`)) return
    setActing(action)
    setError('')
    try {
      await api(`${endpoint}/action`, { method: 'POST', ...jsonBody({ action: selected.type === 'kubernetes' ? 'restart' : action }) })
      await load()
      onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The action could not be completed.')
    } finally {
      setActing('')
    }
  }

  const download = () => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${title.replace(/[^A-Za-z0-9_.-]+/g, '-')}-${tab}.txt`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="workload-drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="workload-drawer" role="dialog" aria-modal="true" aria-label={`${title} workload details`}>
        <header className="workload-drawer-header">
          <span className={`workload-drawer-icon ${selected.type}`}>{selected.type === 'docker' ? <Box size={18} /> : <Boxes size={18} />}</span>
          <div><p>{selected.type === 'docker' ? 'DOCKER CONTAINER' : 'KUBERNETES POD'}</p><h2>{title}</h2><small>{subtitle}</small></div>
          <button className="icon-button" onClick={onClose} aria-label="Close workload details"><X size={16} /></button>
        </header>

        <div className="workload-vitals">
          {selected.type === 'docker' ? <>
            <Vital label="CPU" value={`${selected.item.cpuPercent.toFixed(1)}%`} />
            <Vital label="Memory" value={bytes(selected.item.memoryUsageBytes)} />
            <Vital label="Traffic" value={`${rate(selected.item.networkRxBytesPerSecond)} ↓`} />
            <Vital label="State" value={selected.item.state} tone={selected.item.state.toLowerCase() === 'running' ? 'green' : ''} />
          </> : <>
            <Vital label="CPU" value={millicores(selected.item.cpuUsageMillicores)} />
            <Vital label="Memory" value={bytes(selected.item.memoryUsageBytes)} />
            <Vital label="Traffic" value={`${rate(selected.item.networkRxBytesPerSecond)} ↓`} />
            <Vital label="Ready" value={selected.item.ready} tone={selected.item.phase === 'Running' ? 'green' : ''} />
          </>}
        </div>

        {!logsAllowed ? (
          <section className="workload-upgrade-state">
            <TerminalSquare size={25} />
            <h3>Remote workload access is locked</h3>
            <p>Live logs and inspection are available on Solo. Start, stop and restart controls are available on Team and Scale.</p>
            <Link className="primary-button" to="/billing">Compare plans</Link>
          </section>
        ) : <>
          <div className="workload-drawer-tabs">
            <button className={tab === 'logs' ? 'active' : ''} onClick={() => setTab('logs')}><TerminalSquare size={14} /> Logs</button>
            <button className={tab === 'details' ? 'active' : ''} onClick={() => setTab('details')}><FileJson2 size={14} /> {selected.type === 'docker' ? 'Inspect' : 'Describe'}</button>
          </div>

          <div className="workload-log-toolbar">
            <label><Search size={13} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter output…" /></label>
            {tab === 'logs' && <select value={tail} onChange={(event) => setTail(Number(event.target.value))}><option value={200}>200 lines</option><option value={500}>500 lines</option><option value={1000}>1,000 lines</option><option value={2000}>2,000 lines</option></select>}
            <button className={`icon-button ${autoRefresh && tab === 'logs' ? 'active' : ''}`} title={autoRefresh ? 'Pause live refresh' : 'Resume live refresh'} onClick={() => setAutoRefresh((value) => !value)} disabled={tab !== 'logs'}>{autoRefresh ? <Pause size={14} /> : <Play size={14} />}</button>
            <button className="icon-button" title="Refresh now" onClick={() => void load()}><RefreshCw size={14} className={loading ? 'spin' : ''} /></button>
            <button className="icon-button" title="Copy output" onClick={() => void navigator.clipboard.writeText(content)}><ClipboardCopy size={14} /></button>
            <button className="icon-button" title="Download output" onClick={download}><Download size={14} /></button>
          </div>

          {error && <div className="workload-error"><span>{error}</span><Link to={`/servers/${item.serverId}`}>Open server access</Link></div>}
          <pre className={`workload-output ${loading && !content ? 'loading' : ''}`}>{loading && !content ? 'Opening secure workload channel…' : visibleContent || 'No matching output.'}</pre>
          <footer className="workload-drawer-footer">
            <span>{fetchedAt ? `Updated ${new Date(fetchedAt).toLocaleTimeString()}` : 'Waiting for remote output'}</span>
            <div className="workload-actions">
              {!actionsAllowed && <Link to="/billing">Team controls</Link>}
              {selected.type === 'docker' && <>
                <button disabled={!actionsAllowed || Boolean(acting)} onClick={() => void runAction('start')}><Play size={13} /> Start</button>
                <button disabled={!actionsAllowed || Boolean(acting)} onClick={() => void runAction('stop')}><Square size={12} /> Stop</button>
              </>}
              <button className="action-primary" disabled={!actionsAllowed || Boolean(acting)} onClick={() => void runAction('restart')}><RotateCw size={13} className={acting === 'restart' ? 'spin' : ''} /> Restart</button>
            </div>
          </footer>
        </>}
      </aside>
    </div>
  )
}

function Vital({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return <div className={tone}><span>{label}</span><strong>{value}</strong></div>
}
