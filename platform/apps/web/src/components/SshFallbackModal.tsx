import { useEffect, useState, type FormEvent } from 'react'
import { ArrowRight, KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react'
import type { ServerSummary } from '@monitc/shared'
import { api, ApiError, jsonBody } from '../lib/api'
import { sealSshSecret } from '../lib/vault'
import { Modal } from './Modal'

interface SshFallbackForm {
  host: string
  port: number
  username: string
  authType: 'password' | 'privateKey'
  password: string
  privateKey: string
  passphrase: string
  hostFingerprint: string
}

const emptyForm = (server: ServerSummary): SshFallbackForm => ({
  host: server.host || '',
  port: server.port || 22,
  username: server.username || 'root',
  authType: 'password',
  password: '',
  privateKey: '',
  passphrase: '',
  hostFingerprint: ''
})

export function SshFallbackModal({
  open,
  server,
  onClose,
  onUpdated
}: {
  open: boolean
  server: ServerSummary | null
  onClose(): void
  onUpdated(server: ServerSummary): void
}) {
  const [form, setForm] = useState<SshFallbackForm>(() => emptyForm(server || placeholderServer))
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || !server) return
    setForm(emptyForm(server))
    setError('')
    setPhase('')
  }, [open, server])

  if (!server) return null

  const close = () => {
    if (busy) return
    setError('')
    setPhase('')
    onClose()
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    let saved: ServerSummary | null = null
    try {
      setPhase('Sealing the SSH credential in this browser…')
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
      setPhase('Saving the encrypted SSH fallback…')
      saved = await api<ServerSummary>(`/api/v1/servers/${server.id}`, {
        method: 'PATCH',
        ...jsonBody({ encryptedSecret })
      })
      onUpdated({ ...server, ...saved, agent: server.agent })

      setPhase('Verifying SSH, terminal and SFTP access…')
      await api(`/api/v1/servers/${server.id}/ssh/test`, { method: 'POST' })
      onUpdated({ ...server, ...saved, agent: server.agent, status: 'connected', sshFallbackConfigured: true })
      setForm(emptyForm(server))
      onClose()
    } catch (caught) {
      const message = accessErrorMessage(caught)
      setError(saved ? `The encrypted credential was saved, but the connection test failed. ${message}` : message)
    } finally {
      setBusy(false)
      setPhase('')
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={server.sshFallbackConfigured ? 'Update SSH access' : 'Enable Terminal & Files'}
      subtitle={`Add on-demand SSH access to ${server.name} while native metrics stay on mTLS.`}
      width={600}
    >
      <form className="modal-form server-form" onSubmit={submit}>
        <div className="secure-banner"><ShieldCheck size={17} /><span><strong>Client-side sealed credential</strong><small>Only ciphertext reaches Monitc. SSH is opened only when you use Terminal or Files.</small></span></div>
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
        <label><span>Host key fingerprint <em>optional, pinned on first successful connection</em></span><input value={form.hostFingerprint} onChange={(event) => setForm({ ...form, hostFingerprint: event.target.value })} placeholder="SHA256:…" /></label>
        {error && <p className="form-error">{error}</p>}
        <footer className="modal-actions">
          <span className="modal-phase">{phase}</span>
          <button type="button" className="secondary-button" onClick={close} disabled={busy}>Cancel</button>
          <button className="primary-button" disabled={busy}>{busy ? <span className="button-spinner" /> : <>{server.sshFallbackConfigured ? 'Update access' : 'Enable securely'} <ArrowRight size={15} /></>}</button>
        </footer>
      </form>
    </Modal>
  )
}

function accessErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return error instanceof Error ? error.message : 'SSH access could not be configured.'
  if (error.code === 'SSH_AUTH_FAILED') return 'The username, password or private key was rejected.'
  if (error.code === 'SSH_HOST_KEY_FAILED') return 'The host key fingerprint does not match.'
  if (error.code === 'SSH_TIMEOUT') return 'The SSH host did not respond before the timeout.'
  if (error.code === 'SSH_REFUSED') return 'The host refused the SSH connection.'
  if (error.code === 'TARGET_POLICY_BLOCKED') return 'This target is blocked by the platform network policy.'
  return error.message
}

const placeholderServer: ServerSummary = {
  id: '',
  name: '',
  connectionMode: 'agent',
  status: 'pending',
  sshFallbackConfigured: false,
  lastSeenAt: null,
  createdAt: ''
}
