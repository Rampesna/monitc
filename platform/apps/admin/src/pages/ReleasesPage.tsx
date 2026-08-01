import { useEffect, useState, type FormEvent } from 'react'
import { FileArchive, RefreshCw, Rocket, ShieldCheck, UploadCloud } from 'lucide-react'
import { api } from '../lib/api'

interface ReleaseFile { name: string; size: number; modifiedAt: string }
interface Release { version: string; summary: string; publishedAt: string }

export function ReleasesPage() {
  const [files, setFiles] = useState<ReleaseFile[]>([])
  const [release, setRelease] = useState<Release | null>(null)
  const [version, setVersion] = useState('')
  const [notes, setNotes] = useState('')
  const [artifacts, setArtifacts] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const load = async () => {
    const [fileData, latest] = await Promise.all([
      api<{ files: ReleaseFile[] }>('/api/v1/releases/files'),
      api<Release>('/api/v1/releases/latest')
    ])
    setFiles(fileData.files)
    setRelease(latest)
  }
  useEffect(() => { void load() }, [])
  const publish = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    const body = new FormData()
    body.append('version', version)
    body.append('notes', notes)
    for (const file of artifacts) body.append('files', file)
    try {
      await api('/api/v1/releases', { method: 'POST', body })
      setMessage(`v${version} is now live on the update feed.`)
      setVersion('')
      setNotes('')
      setArtifacts([])
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Release failed.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="ops-page">
      <header className="ops-page-title"><div><p>DESKTOP DELIVERY</p><h1>Releases</h1><span>Validate and publish signed updater artifacts.</span></div>{release && <span className="current-release"><i /> v{release.version} live</span>}</header>
      <div className="release-grid">
        <section className="ops-panel publish-panel"><header><div><h2>Publish a release</h2><p>Manifest is switched only after every artifact is staged.</p></div><Rocket size={15} /></header><form onSubmit={publish}><label><span>Semantic version</span><input required pattern="\d+\.\d+\.\d+.*" value={version} onChange={(event) => setVersion(event.target.value)} placeholder="1.5.0" /></label><label><span>Short release summary</span><textarea rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="What changed?" /></label><label className="artifact-drop"><UploadCloud size={21} /><strong>{artifacts.length ? `${artifacts.length} artifacts selected` : 'Choose release artifacts'}</strong><small>latest*.yml plus signed DMG, ZIP, EXE, AppImage or DEB</small><input type="file" multiple onChange={(event) => setArtifacts([...event.target.files || []])} /></label>{message && <p className="publish-message">{message}</p>}<button disabled={busy || !artifacts.length}>{busy ? <><RefreshCw size={13} className="spin" /> Publishing…</> : <><ShieldCheck size={13} /> Validate & publish</>}</button></form></section>
        <section className="ops-panel files-panel"><header><div><h2>Live artifact store</h2><p>{files.length} files available from the production feed.</p></div><FileArchive size={15} /></header><div>{files.map((file) => <article key={file.name}><span><FileArchive size={13} /></span><div><strong>{file.name}</strong><small>{new Date(file.modifiedAt).toLocaleString()}</small></div><b>{(file.size / 1024 / 1024).toFixed(1)} MB</b></article>)}</div></section>
      </div>
    </div>
  )
}
