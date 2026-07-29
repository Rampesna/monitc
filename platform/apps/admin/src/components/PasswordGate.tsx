import { useState, type FormEvent } from 'react'
import { ArrowRight, KeyRound, ShieldCheck } from 'lucide-react'
import { useAuth } from '../context'
import { api, json } from '../lib/api'
import { Logo } from './Logo'

export function PasswordGate() {
  const { logout } = useAuth()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api('/api/v1/auth/password', {
        method: 'POST',
        ...json({ currentPassword, newPassword })
      })
      await logout()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Password could not be updated.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ops-login password-gate">
      <div className="ops-login-glow" />
      <div className="ops-login-card">
        <Logo />
        <span className="restricted-label"><ShieldCheck size={13} /> First sign-in protection</span>
        <h1>Choose a private password</h1>
        <p>The bootstrap credential is temporary. Set your own password before the control plane opens.</p>
        <form onSubmit={submit}>
          <label><span>Temporary password</span><div><KeyRound size={14} /><input type="password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" /></div></label>
          <label><span>New password</span><div><KeyRound size={14} /><input type="password" required minLength={12} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" /></div></label>
          {error && <p className="ops-error">{error}</p>}
          <button disabled={busy}>{busy ? <i className="spinner" /> : <>Secure account <ArrowRight size={15} /></>}</button>
        </form>
        <small>All previous refresh sessions are revoked after this change.</small>
      </div>
    </div>
  )
}
