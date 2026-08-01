import { useEffect, useState, type FormEvent } from 'react'
import { ArrowRight, Check, Copy, KeyRound, LockKeyhole, RadioTower, Server, ShieldCheck, TerminalSquare } from 'lucide-react'
import type { AgentPairingDetails, ServerConnectionMode, ServerSummary } from '@monitc/shared'
import { api, jsonBody } from '../lib/api'
import { sealSshSecret } from '../lib/vault'
import { Modal } from './Modal'

export function AddServerModal({
  open,
  onClose,
  onCreated,
  serverToPair
}: {
  open: boolean
  onClose(): void
  onCreated(server: ServerSummary): void
  serverToPair?: ServerSummary | null
}) {
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState('')
  const [error, setError] = useState('')
  const [mode, setMode] = useState<ServerConnectionMode>('agent')
  const [pairing, setPairing] = useState<AgentPairingDetails | null>(null)
  const [agentServer, setAgentServer] = useState<ServerSummary | null>(null)
  const [copied, setCopied] = useState<'command' | 'token' | null>(null)
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

  useEffect(() => {
    if (!open || !serverToPair) return
    setMode('agent')
    setAgentServer(serverToPair)
    setForm((current) => ({ ...current, name: serverToPair.name }))
  }, [open, serverToPair])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (mode === 'agent') {
        let server = agentServer
        if (!server) {
          setPhase('Creating the outbound agent connection…')
          server = await api<ServerSummary>('/api/v1/servers', {
            method: 'POST',
            ...jsonBody({ name: form.name, connectionMode: 'agent' })
          })
          setAgentServer(server)
          onCreated(server)
        }
        setPhase('Issuing a one-time pairing identity…')
        const details = await api<AgentPairingDetails>(`/api/v1/servers/${server.id}/agent/pairing-token`, { method: 'POST' })
        setPairing(details)
        return
      }
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
      closeAndReset()
      setForm({ name: '', host: '', port: 22, username: 'root', authType: 'password', password: '', privateKey: '', passphrase: '', hostFingerprint: '' })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The server could not be added.')
    } finally {
      setBusy(false)
      setPhase('')
    }
  }

  const closeAndReset = () => {
    setPairing(null)
    setAgentServer(null)
    setCopied(null)
    setError('')
    setPhase('')
    setForm({ name: '', host: '', port: 22, username: 'root', authType: 'password', password: '', privateKey: '', passphrase: '', hostFingerprint: '' })
    onClose()
  }

  const copy = async (value: string, target: 'command' | 'token') => {
    await navigator.clipboard.writeText(value)
    setCopied(target)
    window.setTimeout(() => setCopied((current) => current === target ? null : current), 1800)
  }

  return (
    <Modal open={open} onClose={busy ? () => undefined : closeAndReset} title={pairing ? "Pair your native agent" : "Add a server"} subtitle={pairing ? "One outbound connection. No inbound SSH credential required." : "Choose the transport that fits this server."} width={620}>
      {pairing && agentServer ? (
        <div className="agent-pairing-panel">
          <div className="pairing-success"><span><Check size={18} /></span><div><strong>{agentServer.name} is ready to pair</strong><small>The token expires {new Date(pairing.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} and is destroyed after first use.</small></div></div>
          <ol className="pairing-steps">
            <li><span>1</span><div><strong>Run the installer on your Linux server</strong><small>It installs a hardened systemd service and the correct CA pin.</small></div></li>
            <li><span>2</span><div><strong>Paste the one-time token when prompted</strong><small>The token is never placed in shell history or stored after pairing.</small></div></li>
            <li><span>3</span><div><strong>Return to Monitc</strong><small>The server switches to live automatically after its first mTLS heartbeat.</small></div></li>
          </ol>
          <div className="pairing-code-block"><header><span><TerminalSquare size={13} /> Install command</span><button type="button" onClick={() => void copy(pairing.installCommand, 'command')}>{copied === 'command' ? <Check size={13} /> : <Copy size={13} />}{copied === 'command' ? 'Copied' : 'Copy'}</button></header><code>{pairing.installCommand}</code></div>
          <div className="pairing-token-block"><div><span>ONE-TIME PAIRING TOKEN</span><strong>{pairing.token}</strong></div><button type="button" onClick={() => void copy(pairing.token, 'token')}>{copied === 'token' ? <Check size={14} /> : <Copy size={14} />}</button></div>
          <div className="pairing-security-note"><ShieldCheck size={15} /><span><strong>mTLS identity, not a reusable password</strong><small>The agent creates its private key locally. Monitc only signs its CSR and the key never leaves your server.</small></span></div>
          <footer className="modal-actions pairing-actions"><button className="primary-button" type="button" onClick={closeAndReset}>Done <ArrowRight size={14} /></button></footer>
        </div>
      ) : <form className="modal-form server-form" onSubmit={submit}>
        <div className="connection-mode-grid">
          <button type="button" className={mode === 'agent' ? 'active' : ''} onClick={() => setMode('agent')}><span><RadioTower size={18} /></span><div><strong>Native agent <em>Recommended</em></strong><small>High-resolution metrics over outbound mTLS. No SSH secret.</small></div></button>
          <button type="button" className={mode === 'ssh' ? 'active' : ''} onClick={() => setMode('ssh')}><span><TerminalSquare size={18} /></span><div><strong>SSH</strong><small>Agentless setup with terminal and SFTP included.</small></div></button>
        </div>
        <div className={`secure-banner ${mode === 'agent' ? 'agent' : ''}`}><ShieldCheck size={17} /><span><strong>{mode === 'agent' ? 'Private key stays on the server' : 'Client-side sealed box'}</strong><small>{mode === 'agent' ? 'Only signed telemetry leaves through an outbound connection.' : 'The database receives ciphertext, never this form.'}</small></span></div>
        <label><span>Connection name</span><div className="input-with-icon"><Server size={15} /><input required disabled={Boolean(agentServer)} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Production core" /></div></label>
        {mode === 'ssh' && <><div className="field-row host-row">
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
        <label><span>Host key fingerprint <em>optional, TOFU if empty</em></span><input value={form.hostFingerprint} onChange={(event) => setForm({ ...form, hostFingerprint: event.target.value })} placeholder="SHA256:…" /></label></>}
        {mode === 'agent' && <div className="agent-explainer"><RadioTower size={17} /><div><strong>What happens next?</strong><p>We create a 15-minute pairing token. Run one command on Linux; the Go agent opens an outbound gRPC stream, generates its own ECDSA key and starts reporting host, Docker and Kubernetes telemetry.</p></div></div>}
        {error && <p className="form-error">{error}</p>}
        <footer className="modal-actions">
          <span className="modal-phase">{phase}</span>
          <button type="button" className="secondary-button" onClick={closeAndReset} disabled={busy}>Cancel</button>
          <button className="primary-button" disabled={busy}>{busy ? <span className="button-spinner" /> : <>{mode === 'agent' ? 'Create pairing' : 'Add securely'} <ArrowRight size={15} /></>}</button>
        </footer>
      </form>}
    </Modal>
  )
}
