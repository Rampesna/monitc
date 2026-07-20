import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ChevronRight, Clipboard, Copy, Download, Edit3, File, FilePlus2,
  Folder, FolderOpen, FolderPlus, HardDrive, Home, LockKeyhole,
  RefreshCw, Scissors, Search, Trash2, Upload
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/common/Button'
import { Modal } from '../components/common/Modal'
import { Spinner } from '../components/common/Spinner'
import { useApp } from '../context/AppContext'
import { formatBytes } from '../lib/format'
import type { SftpEntry } from '../lib/types'

type ClipboardState = { paths: string[]; mode: 'copy' | 'cut' } | null
type PromptState = { kind: 'file' | 'directory' | 'rename' | 'permissions'; value: string } | null

function joinPath(directory: string, name: string): string {
  return `${directory === '/' ? '' : directory}/${name}`.replace(/\/+/g, '/') || '/'
}

function parentPath(remotePath: string): string {
  const parts = remotePath.split('/').filter(Boolean)
  parts.pop()
  return `/${parts.join('/')}` || '/'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default function SftpPage(): React.ReactElement {
  const { t } = useTranslation()
  const { state, dispatch } = useApp()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedServer = searchParams.get('server')
  const initialServer = requestedServer && state.servers.some((server) => server.id === requestedServer)
    ? requestedServer
    : state.selectedServerId ?? state.servers[0]?.id ?? ''
  const [serverId, setServerId] = useState(initialServer)
  const [remotePath, setRemotePath] = useState('/')
  const [entries, setEntries] = useState<SftpEntry[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [clipboard, setClipboard] = useState<ClipboardState>(null)
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [prompt, setPrompt] = useState<PromptState>(null)
  const [editor, setEditor] = useState<{ entry: SftpEntry; content: string; dirty: boolean } | null>(null)
  const [editorLoading, setEditorLoading] = useState(false)

  const selectedEntries = useMemo(() => entries.filter((entry) => selected.has(entry.path)), [entries, selected])
  const visibleEntries = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase()
    return query ? entries.filter((entry) => entry.name.toLocaleLowerCase().includes(query)) : entries
  }, [entries, filter])

  const loadDirectory = useCallback(async (targetPath = remotePath): Promise<void> => {
    if (!serverId) return
    setLoading(true)
    setError('')
    try {
      const result = await window.monitcAPI.sftp.list(serverId, targetPath)
      setEntries(result)
      setRemotePath(targetPath)
      setSelected(new Set())
    } catch (loadError) {
      setError(errorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }, [remotePath, serverId])

  useEffect(() => { void loadDirectory('/') }, [serverId])

  useEffect(() => {
    if (!serverId) return
    setSearchParams({ server: serverId }, { replace: true })
    dispatch({ type: 'SELECT_SERVER', serverId })
  }, [dispatch, serverId, setSearchParams])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 3000)
    return () => clearTimeout(timer)
  }, [notice])

  const runOperation = async (operation: () => Promise<void>, successMessage: string): Promise<void> => {
    setWorking(true)
    setError('')
    try {
      await operation()
      setNotice(successMessage)
      await loadDirectory()
    } catch (operationError) {
      setError(errorMessage(operationError))
    } finally {
      setWorking(false)
    }
  }

  const openEntry = async (entry: SftpEntry): Promise<void> => {
    if (entry.type === 'directory') {
      await loadDirectory(entry.path)
      return
    }
    setEditorLoading(true)
    setError('')
    try {
      const file = await window.monitcAPI.sftp.read(serverId, entry.path)
      setEditor({ entry, content: file.content, dirty: false })
    } catch (readError) {
      setError(errorMessage(readError))
    } finally {
      setEditorLoading(false)
    }
  }

  const choose = (entry: SftpEntry, additive: boolean): void => {
    setSelected((previous) => {
      const next = additive ? new Set(previous) : new Set<string>()
      if (additive && next.has(entry.path)) next.delete(entry.path)
      else next.add(entry.path)
      return next
    })
  }

  const saveEditor = async (): Promise<void> => {
    if (!editor) return
    setWorking(true)
    try {
      await window.monitcAPI.sftp.write(serverId, editor.entry.path, editor.content)
      setEditor({ ...editor, dirty: false })
      setNotice(t('sftp.fileSaved'))
      await loadDirectory()
    } catch (saveError) {
      setError(errorMessage(saveError))
    } finally {
      setWorking(false)
    }
  }

  const submitPrompt = async (): Promise<void> => {
    if (!prompt?.value.trim()) return
    const current = selectedEntries[0]
    if (prompt.kind === 'file') {
      await runOperation(() => window.monitcAPI.sftp.write(serverId, joinPath(remotePath, prompt.value.trim()), '').then(() => {}), t('sftp.created'))
    } else if (prompt.kind === 'directory') {
      await runOperation(() => window.monitcAPI.sftp.mkdir(serverId, joinPath(remotePath, prompt.value.trim())).then(() => {}), t('sftp.created'))
    } else if (prompt.kind === 'rename' && current) {
      await runOperation(() => window.monitcAPI.sftp.rename(serverId, current.path, joinPath(remotePath, prompt.value.trim())).then(() => {}), t('sftp.renamed'))
    } else if (prompt.kind === 'permissions' && current) {
      const mode = Number.parseInt(prompt.value, 8)
      if (!/^[0-7]{3}$/.test(prompt.value)) {
        setError(t('sftp.invalidPermissions'))
        return
      }
      await runOperation(() => window.monitcAPI.sftp.chmod(serverId, current.path, mode).then(() => {}), t('sftp.permissionsChanged'))
    }
    setPrompt(null)
  }

  const paste = async (): Promise<void> => {
    if (!clipboard) return
    await runOperation(
      () => window.monitcAPI.sftp.paste(serverId, clipboard.paths, remotePath, clipboard.mode === 'cut').then(() => {}),
      t('sftp.pasted')
    )
    if (clipboard.mode === 'cut') setClipboard(null)
  }

  const removeSelected = async (): Promise<void> => {
    if (!selected.size || !confirm(t('sftp.deleteConfirm', { count: selected.size }))) return
    await runOperation(() => window.monitcAPI.sftp.remove(serverId, [...selected]).then(() => {}), t('sftp.deleted'))
  }

  const upload = async (): Promise<void> => {
    setWorking(true)
    setError('')
    try {
      const result = await window.monitcAPI.sftp.upload(serverId, remotePath)
      if (!result.canceled) {
        setNotice(t('sftp.uploaded', { count: result.uploaded }))
        await loadDirectory()
      }
    } catch (uploadError) {
      setError(errorMessage(uploadError))
    } finally {
      setWorking(false)
    }
  }

  const download = async (): Promise<void> => {
    const entry = selectedEntries[0]
    if (!entry || entry.type === 'directory') return
    setWorking(true)
    try {
      const result = await window.monitcAPI.sftp.download(serverId, entry.path)
      if (!result.canceled) setNotice(t('sftp.downloaded'))
    } catch (downloadError) {
      setError(errorMessage(downloadError))
    } finally {
      setWorking(false)
    }
  }

  useEffect(() => {
    const handleKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement
      if (target.matches('input, textarea, select') || editor) return
      const mod = event.ctrlKey || event.metaKey
      if (mod && event.key.toLowerCase() === 'a') { event.preventDefault(); setSelected(new Set(visibleEntries.map((entry) => entry.path))) }
      if (mod && event.key.toLowerCase() === 'c' && selected.size) { event.preventDefault(); setClipboard({ paths: [...selected], mode: 'copy' }) }
      if (mod && event.key.toLowerCase() === 'x' && selected.size) { event.preventDefault(); setClipboard({ paths: [...selected], mode: 'cut' }) }
      if (mod && event.key.toLowerCase() === 'v' && clipboard) { event.preventDefault(); void paste() }
      if (event.key === 'Delete' && selected.size) void removeSelected()
      if (event.key === 'F2' && selectedEntries.length === 1) setPrompt({ kind: 'rename', value: selectedEntries[0].name })
      if (event.key === 'Backspace' && remotePath !== '/') void loadDirectory(parentPath(remotePath))
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [clipboard, editor, remotePath, selected, selectedEntries, visibleEntries])

  const crumbs = remotePath.split('/').filter(Boolean)

  if (!state.servers.length) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-center p-8">
        <FolderOpen size={36} className="text-slate-600" />
        <h1 className="text-lg font-semibold text-slate-200">{t('sftp.noServerTitle')}</h1>
        <p className="text-sm text-slate-500">{t('sftp.noServer')}</p>
      </div>
    )
  }

  return (
    <div className="h-full min-h-0 flex flex-col p-5 gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-600/20 flex items-center justify-center"><FolderOpen size={18} className="text-indigo-400" /></div>
          <div>
            <h1 className="text-lg font-semibold text-slate-100">{t('sftp.title')}</h1>
            <p className="text-xs text-slate-500">{t('sftp.subtitle')}</p>
          </div>
        </div>
        <select value={serverId} onChange={(event) => setServerId(event.target.value)} className="bg-[#12121a] border border-[#2d2d45] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500">
          {state.servers.map((server) => <option key={server.id} value={server.id}>{server.name} — {server.host}</option>)}
        </select>
      </div>

      <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-2 flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="ghost" icon={<FilePlus2 size={14} />} onClick={() => setPrompt({ kind: 'file', value: '' })}>{t('sftp.newFile')}</Button>
        <Button size="sm" variant="ghost" icon={<FolderPlus size={14} />} onClick={() => setPrompt({ kind: 'directory', value: '' })}>{t('sftp.newFolder')}</Button>
        <span className="w-px h-6 bg-[#2d2d45] mx-1" />
        <Button size="sm" variant="ghost" icon={<Upload size={14} />} onClick={upload}>{t('sftp.upload')}</Button>
        <Button size="sm" variant="ghost" icon={<Download size={14} />} disabled={selectedEntries.length !== 1 || selectedEntries[0]?.type === 'directory'} onClick={download}>{t('sftp.download')}</Button>
        <span className="w-px h-6 bg-[#2d2d45] mx-1" />
        <Button size="sm" variant="ghost" icon={<Copy size={14} />} disabled={!selected.size} onClick={() => setClipboard({ paths: [...selected], mode: 'copy' })}>{t('common.copy')}</Button>
        <Button size="sm" variant="ghost" icon={<Scissors size={14} />} disabled={!selected.size} onClick={() => setClipboard({ paths: [...selected], mode: 'cut' })}>{t('sftp.cut')}</Button>
        <Button size="sm" variant="ghost" icon={<Clipboard size={14} />} disabled={!clipboard} onClick={paste}>{t('sftp.paste')}</Button>
        <Button size="sm" variant="ghost" icon={<Edit3 size={14} />} disabled={selectedEntries.length !== 1} onClick={() => setPrompt({ kind: 'rename', value: selectedEntries[0]?.name ?? '' })}>{t('sftp.rename')}</Button>
        <Button size="sm" variant="ghost" icon={<LockKeyhole size={14} />} disabled={selectedEntries.length !== 1} onClick={() => setPrompt({ kind: 'permissions', value: selectedEntries[0]?.mode.toString(8).padStart(3, '0') ?? '644' })}>{t('sftp.permissions')}</Button>
        <Button size="sm" variant="ghost" className="text-red-400" icon={<Trash2 size={14} />} disabled={!selected.size} onClick={removeSelected}>{t('common.delete')}</Button>
        <div className="ml-auto flex items-center gap-2">
          {clipboard && <span className="text-[11px] text-indigo-300 bg-indigo-500/10 px-2 py-1 rounded-md">{clipboard.paths.length} · {t(`sftp.${clipboard.mode}`)}</span>}
          <button onClick={() => loadDirectory()} disabled={loading} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5" title={t('common.refresh')}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0 h-9 flex items-center gap-1 bg-[#12121a] border border-[#1e1e2e] rounded-lg px-2 overflow-x-auto">
          <button onClick={() => loadDirectory('/')} className="p-1.5 text-slate-500 hover:text-indigo-300"><Home size={13} /></button>
          {crumbs.map((crumb, index) => {
            const target = `/${crumbs.slice(0, index + 1).join('/')}`
            return <React.Fragment key={target}><ChevronRight size={12} className="text-slate-700 flex-shrink-0" /><button onClick={() => loadDirectory(target)} className="text-xs text-slate-400 hover:text-indigo-300 whitespace-nowrap">{crumb}</button></React.Fragment>
          })}
        </div>
        <div className="relative w-56">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
          <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder={t('sftp.search')} className="w-full h-9 bg-[#12121a] border border-[#1e1e2e] rounded-lg pl-8 pr-3 text-xs text-slate-200 focus:outline-none focus:border-indigo-500" />
        </div>
      </div>

      {(error || notice) && <div className={`px-3 py-2 rounded-lg text-xs border ${error ? 'bg-red-500/10 border-red-500/20 text-red-300' : 'bg-green-500/10 border-green-500/20 text-green-300'}`}>{error || notice}</div>}

      <div className="flex-1 min-h-0 bg-[#12121a] border border-[#1e1e2e] rounded-xl overflow-auto relative">
        {(working || editorLoading) && <div className="absolute inset-0 z-10 bg-[#0d0d14]/60 backdrop-blur-[1px] flex items-center justify-center"><Spinner className="text-indigo-400" /></div>}
        <table className="w-full text-left table-fixed">
          <thead className="sticky top-0 z-[1] bg-[#15151f] border-b border-[#242435] text-[11px] uppercase tracking-wider text-slate-500">
            <tr><th className="w-10 px-3 py-2.5"><input type="checkbox" checked={visibleEntries.length > 0 && visibleEntries.every((entry) => selected.has(entry.path))} onChange={(event) => setSelected(event.target.checked ? new Set(visibleEntries.map((entry) => entry.path)) : new Set())} /></th><th className="px-2 py-2.5">{t('common.name')}</th><th className="w-28 px-2 py-2.5">{t('common.size')}</th><th className="w-40 px-2 py-2.5">{t('sftp.modified')}</th><th className="w-36 px-2 py-2.5">{t('sftp.permissions')}</th><th className="w-12" /></tr>
          </thead>
          <tbody>
            {!loading && visibleEntries.map((entry) => {
              const isSelected = selected.has(entry.path)
              return (
                <tr key={entry.path} onClick={(event) => choose(entry, event.metaKey || event.ctrlKey)} onDoubleClick={() => openEntry(entry)} className={`border-b border-[#1b1b28] text-xs cursor-default select-none ${isSelected ? 'bg-indigo-500/10' : 'hover:bg-white/[0.025]'}`}>
                  <td className="px-3 py-2.5"><input type="checkbox" checked={isSelected} onChange={() => choose(entry, true)} onClick={(event) => event.stopPropagation()} /></td>
                  <td className="px-2 py-2.5"><div className="flex items-center gap-2 min-w-0">{entry.type === 'directory' ? <Folder size={16} className="text-amber-400 fill-amber-400/20 flex-shrink-0" /> : <File size={15} className="text-slate-500 flex-shrink-0" />}<span className="text-slate-200 truncate">{entry.name}</span>{clipboard?.paths.includes(entry.path) && <span className="text-[9px] text-indigo-400 border border-indigo-500/20 rounded px-1">{t(`sftp.${clipboard.mode}`)}</span>}</div></td>
                  <td className="px-2 py-2.5 text-slate-500">{entry.type === 'directory' ? '—' : formatBytes(entry.size)}</td>
                  <td className="px-2 py-2.5 text-slate-500">{new Date(entry.modifiedAt).toLocaleString()}</td>
                  <td className="px-2 py-2.5 font-mono text-slate-500">{entry.permissions}</td>
                  <td className="px-2"><button onClick={(event) => { event.stopPropagation(); void openEntry(entry) }} className="p-1.5 text-slate-600 hover:text-indigo-300" title={t('sftp.openFiles')}><ChevronRight size={14} /></button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {loading && <div className="h-52 flex items-center justify-center"><Spinner className="text-indigo-400" /></div>}
        {!loading && !visibleEntries.length && <div className="h-52 flex flex-col items-center justify-center gap-2 text-slate-600"><HardDrive size={26} /><p className="text-xs">{filter ? t('sftp.noSearchResults') : t('sftp.emptyFolder')}</p></div>}
      </div>
      <div className="flex items-center justify-between text-[11px] text-slate-600 px-1"><span>{t('sftp.itemCount', { count: entries.length })}{selected.size ? ` · ${t('sftp.selectedCount', { count: selected.size })}` : ''}</span><span>{state.connectionStatuses[serverId] === 'connected' ? t('common.connected') : t('common.connecting')}</span></div>

      <Modal open={Boolean(prompt)} onClose={() => setPrompt(null)} title={prompt ? t(`sftp.${prompt.kind === 'directory' ? 'newFolder' : prompt.kind === 'file' ? 'newFile' : prompt.kind}`) : ''} footer={<div className="flex justify-end gap-2"><Button onClick={() => setPrompt(null)}>{t('common.cancel')}</Button><Button variant="primary" disabled={!prompt?.value.trim()} onClick={submitPrompt}>{t('common.save')}</Button></div>}>
        <label className="block text-xs text-slate-400">{prompt?.kind === 'permissions' ? t('sftp.permissionMode') : t('common.name')}<input autoFocus value={prompt?.value ?? ''} onChange={(event) => setPrompt(prompt ? { ...prompt, value: event.target.value } : null)} onKeyDown={(event) => { if (event.key === 'Enter') void submitPrompt() }} className="mt-2 w-full bg-[#0d0d14] border border-[#2d2d45] rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500" /></label>
      </Modal>

      <Modal open={Boolean(editor)} onClose={() => { if (!editor?.dirty || confirm(t('sftp.unsavedConfirm'))) setEditor(null) }} title={editor?.entry.name ?? ''} size="xl" footer={<div className="flex items-center justify-between"><span className="text-[11px] text-slate-500">{editor?.entry.path}</span><div className="flex gap-2"><Button onClick={() => { if (!editor?.dirty || confirm(t('sftp.unsavedConfirm'))) setEditor(null) }}>{t('common.close')}</Button><Button variant="primary" loading={working} disabled={!editor?.dirty} onClick={saveEditor}>{t('common.save')}</Button></div></div>}>
        <textarea value={editor?.content ?? ''} onChange={(event) => setEditor(editor ? { ...editor, content: event.target.value, dirty: true } : null)} spellCheck={false} className="w-full h-[58vh] resize-none bg-[#09090d] border border-[#242435] rounded-lg p-4 font-mono text-xs leading-5 text-slate-200 focus:outline-none focus:border-indigo-500" />
      </Modal>
    </div>
  )
}
