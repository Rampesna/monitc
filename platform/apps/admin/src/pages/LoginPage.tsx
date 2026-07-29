import { useState, type FormEvent } from 'react'
import { ArrowRight, KeyRound, ShieldCheck } from 'lucide-react'
import { Navigate } from 'react-router'
import { useAuth } from '../context'
import { Logo } from '../components/Logo'

export function LoginPage() {
  const { user, login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (user) return <Navigate to="/" replace />
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try { await login(email, password) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not sign in.') }
    finally { setBusy(false) }
  }
  return (
    <div className="ops-login">
      <div className="ops-login-glow" />
      <div className="ops-login-card">
        <Logo />
        <span className="restricted-label"><ShieldCheck size={13} /> Restricted control plane</span>
        <h1>Platform operations</h1>
        <p>Sign in with the designated monitc super administrator account.</p>
        <form onSubmit={submit}>
          <label><span>Email</span><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></label>
          <label><span>Password</span><div><KeyRound size={14} /><input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></div></label>
          {error && <p className="ops-error">{error}</p>}
          <button disabled={busy}>{busy ? <i className="spinner" /> : <>Open operations <ArrowRight size={15} /></>}</button>
        </form>
        <small>Access is audited · refresh sessions rotate on every use</small>
      </div>
    </div>
  )
}
