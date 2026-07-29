import { useState, type FormEvent } from 'react'
import { ArrowRight, Check, Eye, EyeOff, KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react'
import { Navigate } from 'react-router'
import { useAuth } from '../context'
import { Logo } from '../components/Logo'

export function AuthPage() {
  const { user, login, register } = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    email: '',
    password: '',
    displayName: '',
    workspaceName: ''
  })
  if (user) return <Navigate to="/" replace />

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (mode === 'login') await login(form.email, form.password)
      else await register(form)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not continue.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-atmosphere" />
      <section className="auth-story">
        <Logo />
        <div className="auth-story-copy">
          <p className="eyebrow">OPERATIONS, WITHOUT THE NOISE</p>
          <h1>Every server.<br /><span>One calm workspace.</span></h1>
          <p>Observe infrastructure, open secure sessions and move from signal to action without changing tools.</p>
          <div className="auth-proof">
            <span><ShieldCheck size={17} /><b>Sealed credentials</b><small>Encrypted before they leave this browser.</small></span>
            <span><LockKeyhole size={17} /><b>Short-lived access</b><small>Rotating sessions with role-based controls.</small></span>
            <span><KeyRound size={17} /><b>No plaintext vault</b><small>Sensitive connection data is never stored in clear text.</small></span>
          </div>
        </div>
        <p className="auth-legal">© {new Date().getFullYear()} monitc · Infrastructure, beautifully focused.</p>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <div className="auth-mobile-logo"><Logo /></div>
          <p className="eyebrow">{mode === 'login' ? 'WELCOME BACK' : 'START WITH COMMUNITY'}</p>
          <h2>{mode === 'login' ? 'Sign in to monitc' : 'Create your workspace'}</h2>
          <p className="auth-subtitle">
            {mode === 'login' ? 'Continue to your infrastructure workspace.' : 'No card. Begin with two monitored servers.'}
          </p>
          <form onSubmit={submit}>
            {mode === 'register' && (
              <div className="field-row">
                <label><span>Your name</span><input required value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} autoComplete="name" /></label>
                <label><span>Workspace</span><input required value={form.workspaceName} onChange={(e) => setForm({ ...form, workspaceName: e.target.value })} placeholder="Acme Ops" /></label>
              </div>
            )}
            <label><span>Email</span><input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" placeholder="you@company.com" /></label>
            <label>
              <span>Password</span>
              <div className="password-field">
                <input type={showPassword ? 'text' : 'password'} required minLength={mode === 'register' ? 12 : 1} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
                <button type="button" onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button>
              </div>
            </label>
            {mode === 'register' && <p className="password-note"><Check size={12} /> Use at least 12 characters.</p>}
            {error && <p className="form-error">{error}</p>}
            <button className="primary-button auth-submit" disabled={busy}>
              {busy ? <span className="button-spinner" /> : <>{mode === 'login' ? 'Sign in' : 'Create workspace'} <ArrowRight size={16} /></>}
            </button>
          </form>
          <p className="auth-switch">
            {mode === 'login' ? 'New to monitc?' : 'Already have an account?'}
            <button onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError('') }}>
              {mode === 'login' ? 'Create a workspace' : 'Sign in'}
            </button>
          </p>
        </div>
      </section>
    </div>
  )
}
