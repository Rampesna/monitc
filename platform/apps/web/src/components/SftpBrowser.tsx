import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Clipboard,
  Copy,
  Download,
  File,
  FileCode2,
  Folder,
  FolderPlus,
  Home,
  Pencil,
  RefreshCw,
  Save,
  Scissors,
  Search,
  Trash2,
  Upload
} from 'lucide-react'
import { api, apiBlob, jsonBody } from '../lib/api'
import { bytes } from '../lib/format'
import { Modal } from './Modal'

interface FileEntry {
  name: string
  path: string
  type: 'directory' | 'symlink' | 'file'
  size: number
  mode: number
  modifiedAt: string
}

interface ClipboardEntry {
  entry: FileEntry
  mode: 'copy' | 'cut'
}

export function SftpBrowser({ serverId }: { serverId: string }) {
  const [path, setPath] = useState('/')
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [selected, setSelected] = useState<FileEntry | null>(null)
  const [clipboard, setClipboard] = useState<ClipboardEntry | null>(null)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editor, setEditor] = useState<{ path: string; content: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const uploadInput = useRef<HTMLInputElement>(null)

  const load = async (target = path) => {
    setLoading(true)
    setError('')
    try {
      const data = await api<{ path: string; entries: FileEntry[] }>(
        `/api/v1/servers/${serverId}/files?path=${encodeURIComponent(target)}`
      )
      setPath(data.path)
      setEntries(data.entries)
      setSelected(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Folder could not be loaded.')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load('/') }, [serverId])
  const visible = useMemo(
    () => entries.filter((entry) => entry.name.toLowerCase().includes(query.toLowerCase())),
    [entries, query]
  )
  const segments = path.split('/').filter(Boolean)

  const open = async (entry: FileEntry) => {
    if (entry.type === 'directory') return load(entry.path)
    const data = await api<{ path: string; content: string }>(
      `/api/v1/servers/${serverId}/files/content?path=${encodeURIComponent(entry.path)}`
    )
    setEditor(data)
  }
  const newFolder = async () => {
    const name = window.prompt('Folder name')
    if (!name || name.includes('/')) return
    await api(`/api/v1/servers/${serverId}/files/folder`, {
      method: 'POST',
      ...jsonBody({ path: `${path.replace(/\/$/, '')}/${name}` })
    })
    await load()
  }
  const remove = async () => {
    if (!selected || !window.confirm(`Delete ${selected.name}? This cannot be undone.`)) return
    await api(`/api/v1/servers/${serverId}/files?path=${encodeURIComponent(selected.path)}`, { method: 'DELETE' })
    await load()
  }
  const paste = async () => {
    if (!clipboard) return
    const target = `${path.replace(/\/$/, '')}/${clipboard.entry.name}`
    await api(`/api/v1/servers/${serverId}/files/${clipboard.mode === 'copy' ? 'copy' : 'move'}`, {
      method: 'POST',
      ...jsonBody({ source: clipboard.entry.path, target })
    })
    if (clipboard.mode === 'cut') setClipboard(null)
    await load()
  }
  const rename = async () => {
    if (!selected) return
    const name = window.prompt('New name', selected.name)
    if (!name || name === selected.name || name.includes('/')) return
    await api(`/api/v1/servers/${serverId}/files/move`, {
      method: 'POST',
      ...jsonBody({ source: selected.path, target: `${path.replace(/\/$/, '')}/${name}` })
    })
    await load()
  }
  const download = async () => {
    if (!selected || selected.type === 'directory') return
    const blob = await apiBlob(`/api/v1/servers/${serverId}/files/download?path=${encodeURIComponent(selected.path)}`)
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = selected.name
    anchor.click()
    URL.revokeObjectURL(url)
  }
  const upload = async (files: FileList | null) => {
    if (!files?.length) return
    const body = new FormData()
    for (const file of files) body.append('files', file)
    await api(`/api/v1/servers/${serverId}/files/upload?path=${encodeURIComponent(path)}`, { method: 'POST', body })
    if (uploadInput.current) uploadInput.current.value = ''
    await load()
  }
  const save = async () => {
    if (!editor) return
    setSaving(true)
    try {
      await api(`/api/v1/servers/${serverId}/files/content`, {
        method: 'PUT',
        ...jsonBody(editor)
      })
      setEditor(null)
      await load()
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="files-workspace">
      <div className="files-toolbar">
        <div className="tool-group">
          <button className="icon-button" onClick={() => void load(parentPath(path))} disabled={path === '/'} title="Back"><ArrowLeft size={15} /></button>
          <button className="tool-button" onClick={() => void newFolder()}><FolderPlus size={15} /> New folder</button>
          <button className="tool-button" onClick={() => uploadInput.current?.click()}><Upload size={15} /> Upload</button>
          <input ref={uploadInput} type="file" multiple hidden onChange={(event) => void upload(event.target.files)} />
        </div>
        <span className="tool-separator" />
        <div className="tool-group">
          <button className="tool-button" disabled={!selected} onClick={() => selected && setClipboard({ entry: selected, mode: 'copy' })}><Copy size={14} /> Copy</button>
          <button className="tool-button" disabled={!selected} onClick={() => selected && setClipboard({ entry: selected, mode: 'cut' })}><Scissors size={14} /> Cut</button>
          <button className="tool-button" disabled={!clipboard} onClick={() => void paste()}><Clipboard size={14} /> Paste</button>
          <button className="tool-button" disabled={!selected} onClick={() => void rename()}><Pencil size={14} /> Rename</button>
          <button className="tool-button" disabled={!selected || selected.type === 'directory'} onClick={() => void download()}><Download size={14} /> Download</button>
          <button className="tool-button danger" disabled={!selected} onClick={() => void remove()}><Trash2 size={14} /> Delete</button>
        </div>
        <button className="icon-button refresh-files" onClick={() => void load()}><RefreshCw size={15} className={loading ? 'spin' : ''} /></button>
      </div>
      <div className="files-pathbar">
        <div className="breadcrumbs">
          <button onClick={() => void load('/')}><Home size={13} /></button>
          {segments.map((segment, index) => (
            <span key={`${segment}-${index}`}><i>/</i><button onClick={() => void load(`/${segments.slice(0, index + 1).join('/')}`)}>{segment}</button></span>
          ))}
        </div>
        <div className="search-field compact"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this folder…" /></div>
      </div>
      {clipboard && <div className="clipboard-bar"><Clipboard size={13} /><span>{clipboard.mode === 'copy' ? 'Copying' : 'Moving'} <strong>{clipboard.entry.name}</strong></span><button onClick={() => setClipboard(null)}>Clear</button></div>}
      <div className="files-table-wrap">
        <table className="data-table files-table">
          <thead><tr><th>Name</th><th>Size</th><th>Modified</th><th>Permissions</th></tr></thead>
          <tbody>
            {visible.map((entry) => (
              <tr key={entry.path} className={selected?.path === entry.path ? 'selected' : ''} onClick={() => setSelected(entry)} onDoubleClick={() => void open(entry)}>
                <td><span className={`file-icon ${entry.type}`}>{entry.type === 'directory' ? <Folder size={16} /> : isCode(entry.name) ? <FileCode2 size={16} /> : <File size={16} />}</span><strong>{entry.name}</strong></td>
                <td>{entry.type === 'directory' ? '—' : bytes(entry.size)}</td>
                <td>{new Date(entry.modifiedAt).toLocaleString()}</td>
                <td><code>{entry.mode.toString(8).padStart(3, '0')}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <div className="table-loading"><span className="button-spinner" /> Reading folder…</div>}
        {!loading && !visible.length && <div className="small-empty"><Folder size={22} /><h3>This folder is empty</h3></div>}
        {error && <div className="table-error">{error}</div>}
      </div>
      <footer className="files-status"><span>{visible.length} items</span><span>Connected over SFTP</span></footer>

      <Modal open={Boolean(editor)} onClose={() => setEditor(null)} title={editor?.path.split('/').pop() || 'Edit file'} subtitle={editor?.path} width={840}>
        <div className="file-editor">
          <textarea value={editor?.content || ''} onChange={(event) => editor && setEditor({ ...editor, content: event.target.value })} spellCheck={false} />
          <footer className="modal-actions"><span>UTF-8 · {bytes(new Blob([editor?.content || '']).size)}</span><button className="secondary-button" onClick={() => setEditor(null)}>Cancel</button><button className="primary-button" onClick={() => void save()} disabled={saving}><Save size={14} /> Save remotely</button></footer>
        </div>
      </Modal>
    </section>
  )
}

function parentPath(value: string): string {
  const parts = value.split('/').filter(Boolean)
  parts.pop()
  return `/${parts.join('/')}` || '/'
}

function isCode(name: string): boolean {
  return /\.(tsx?|jsx?|json|ya?ml|toml|env|conf|ini|md|sh|py|go|rs|java|css|html|sql)$/i.test(name)
}
