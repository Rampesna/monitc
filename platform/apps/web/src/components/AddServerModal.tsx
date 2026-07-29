import { useState, type FormEvent } from 'react'
import { ArrowRight, KeyRound, LockKeyhole, Server, ShieldCheck } from 'lucide-react'
import type { ServerSummary } from '@monitc/shared'
import { api, jsonBody } from '../lib/api'
import { sealSshSecret } from '../lib/vault'
import { Modal } from './Modal'

export function AddServerModal({
  open,
  onClose,
  onCreated
}: {
  open: boolean
  onClose(): void
  onCreated(server: ServerSummary): void
}) {
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState('')
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    name: '',
    host: '',
    port: 22,
    username: 'root',
    authType: 'password' as 'password' | 'privateKey',
    password: '',
    privateKey: '',
    passphrase: '',
    hostFingerprint: ''
  })

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      setPhase('Sealing credentials in your browser…')
      const encryptedSecret = await sealSshSecret({
        host: form.host,
        port: form.port,
        username: form.username,
        authType: form.authType,
        password: form.authType === 'password' ? form.password : undefined,
        privateKey: form.authType === 'privateKey' ? form.privateKey : undefined,
        passphrase: form.authType === 'privateKey' ? form.passphrase || undefined : undefined,
        hostFingerprint: form.hostFingerprint || undefined
      })
      setPhase('Creating secure connection…')
      const server = await api<ServerSummary>('/api/v1/servers', {
        method: 'POST',
        ...jsonBody({ name: form.name, connectionMode: 'ssh', encryptedSecret })
      })
      setPhase('Testing SSH and collecting the first sample…')
      let status: ServerSummary['status'] = server.status
      try {
        await api(`/api/v1/servers/${server.id}/test`, { method: 'POST' })
        status = 'connected'
      } catch {
        // The connection is still saved so it can be corrected without entering
        // the encrypted credentials again. The server list exposes its real state.
        status = 'degraded'
      }
      onCreated({ ...server, status })
      onClose()
      setForm({ name: '', host: '', port: 22, username: 'root', authType: 'password', password: '', privateKey: '', passphrase: '', hostFingerprint: '' })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The server could not be added.')
    } finally {
      setBusy(false)
      setPhase('')
    }
  }

  return (
    <Modal open={open} onClose={busy ? () => undefined : onClose} title="Add a server" subtitle="Connection details are sealed in this browser before upload.">
      <form className="modal-form server-form" onSubmit={submit}>
        <div className="secure-banner"><ShieldCheck size={17} /><span><strong>Client-side sealed box</strong><small>The database receives ciphertext, never this form.</small></span></div>
        <label><span>Connection name</span><div className="input-with-icon"><Server size={15} /><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Production core" /></div></label>
        <div className="field-row host-row">
          <label><span>Hostname or public IP</span><input required value={form.host} onChange={(event) => setForm({ ...form, host: event.target.value })} placeholder="server.example.com" /></label>
          <label><span>Port</span><input type="number" min="1" max="65535" required value={form.port} onChange={(event) => setForm({ ...form, port: Number(event.target.value) })} /></label>
        </div>
        <label><span>Username</span><input required value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} autoComplete="off" /></label>
        <div className="segmented-control">
          <button type="button" className={form.authType === 'password' ? 'active' : ''} onClick={() => setForm({ ...form, authType: 'password' })}><LockKeyhole size={14} /> Password</button>
          <button type="button" className={form.authType === 'privateKey' ? 'active' : ''} onClick={() => setForm({ ...form, authType: 'privateKey' })}><KeyRound size={14} /> Private key</button>
        </div>
        {form.authType === 'password' ? (
          <label><span>Password</span><input required type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} autoComplete="new-password" /></label>
        ) : (
          <>
            <label><span>Private key</span><textarea required rows={6} value={form.privateKey} onChange={(event) => setForm({ ...form, privateKey: event.target.value })} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" /></label>
            <label><span>Passphrase <em>optional</em></span><input type="password" value={form.passphrase} onChange={(event) => setForm({ ...form, passphrase: event.target.value })} /></label>
          </>
        )}
        <label><span>Host key fingerprint <em>optional, TOFU if empty</em></span><input value={form.hostFingerprint} onChange={(event) => setForm({ ...form, hostFingerprint: event.target.value })} placeholder="SHA256:…" /></label>
        {error && <p className="form-error">{error}</p>}
        <footer className="modal-actions">
          <span className="modal-phase">{phase}</span>
          <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="primary-button" disabled={busy}>{busy ? <span className="button-spinner" /> : <>Add securely <ArrowRight size={15} /></>}</button>
        </footer>
      </form>
    </Modal>
  )
}
