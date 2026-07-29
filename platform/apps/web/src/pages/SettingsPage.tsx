import { useEffect, useState, type FormEvent } from 'react'
import {
  KeyRound,
  LockKeyhole,
  Plus,
  Save,
  ScrollText,
  ShieldCheck,
  Trash2,
  UserRound,
  UsersRound
} from 'lucide-react'
import { useAuth } from '../context'
import { api, jsonBody } from '../lib/api'

type Tab = 'profile' | 'security' | 'team' | 'audit'

interface Member {
  userId: string
  email: string
  displayName: string
  role: 'owner' | 'admin' | 'operator' | 'viewer'
  joinedAt: string
}

interface Session {
  id: string
  current: boolean
  active: boolean
  createdAt: string
  expiresAt: string
}

interface AuditEntry {
  id: number
  actorEmail: string | null
  action: string
  resourceType: string
  resourceId: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

export function SettingsPage() {
  const { user, workspace, logout } = useAuth()
  const canManageMembers = workspace?.role === 'owner' || workspace?.role === 'admin'
  const auditEnabled = Boolean(workspace?.plan.entitlements.auditLog)
  const [tab, setTab] = useState<Tab>('profile')
  const [password, setPassword] = useState({ currentPassword: '', newPassword: '' })
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [sessions, setSessions] = useState<Session[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([])
  const [invite, setInvite] = useState({ email: '', role: 'viewer' as Member['role'] })
  const [confirmMember, setConfirmMember] = useState('')

  const loadSessions = () =>
    api<{ sessions: Session[] }>('/api/v1/auth/sessions').then((data) => setSessions(data.sessions))
  const loadMembers = () =>
    api<{ members: Member[] }>('/api/v1/workspaces/current/members').then((data) => setMembers(data.members))
  const loadAudit = () =>
    api<{ entries: AuditEntry[] }>('/api/v1/workspaces/current/audit').then((data) => setAuditEntries(data.entries))

  useEffect(() => {
    setMessage('')
    setError('')
    if (tab === 'security') void loadSessions().catch(showError)
    if (tab === 'team' && canManageMembers) void loadMembers().catch(showError)
    if (tab === 'audit' && auditEnabled) void loadAudit().catch(showError)
  }, [tab])

  const showError = (caught: unknown) => {
    setError(caught instanceof Error ? caught.message : 'The operation could not be completed.')
  }

  const changePassword = async (event: FormEvent) => {
    event.preventDefault()
    setMessage('')
    setError('')
    try {
      await api('/api/v1/auth/password', { method: 'POST', ...jsonBody(password) })
      setMessage('Password updated. Sign in again with the new password.')
      window.setTimeout(() => void logout(), 1200)
    } catch (caught) {
      showError(caught)
    }
  }

  const addMember = async (event: FormEvent) => {
    event.preventDefault()
    setMessage('')
    setError('')
    try {
      const member = await api<Member>('/api/v1/workspaces/current/members', {
        method: 'POST',
        ...jsonBody(invite)
      })
      setMembers((current) => [...current, member])
      setInvite({ email: '', role: 'viewer' })
      setMessage(`${member.displayName} joined the workspace.`)
    } catch (caught) {
      showError(caught)
    }
  }

  const changeRole = async (member: Member, role: Member['role']) => {
    setError('')
    try {
      const updated = await api<Member>(`/api/v1/workspaces/current/members/${member.userId}`, {
        method: 'PATCH',
        ...jsonBody({ role })
      })
      setMembers((current) => current.map((item) => item.userId === updated.userId ? updated : item))
    } catch (caught) {
      showError(caught)
    }
  }

  const removeMember = async (member: Member) => {
    if (confirmMember !== member.userId) {
      setConfirmMember(member.userId)
      return
    }
    setError('')
    try {
      await api(`/api/v1/workspaces/current/members/${member.userId}`, { method: 'DELETE' })
      setMembers((current) => current.filter((item) => item.userId !== member.userId))
      setConfirmMember('')
    } catch (caught) {
      showError(caught)
    }
  }

  const revokeSession = async (session: Session) => {
    setError('')
    try {
      await api(`/api/v1/auth/sessions/${session.id}`, { method: 'DELETE' })
      if (session.current) {
        await logout()
        return
      }
      await loadSessions()
    } catch (caught) {
      showError(caught)
    }
  }

  const revokeOtherSessions = async () => {
    setError('')
    try {
      const result = await api<{ revoked: number }>('/api/v1/auth/sessions/revoke-others', { method: 'POST' })
      setMessage(`${result.revoked} other session${result.revoked === 1 ? '' : 's'} revoked.`)
      await loadSessions()
    } catch (caught) {
      showError(caught)
    }
  }

  const tabs: Array<{ id: Tab; label: string; icon: typeof UserRound; visible: boolean }> = [
    { id: 'profile', label: 'Profile', icon: UserRound, visible: true },
    { id: 'security', label: 'Security & sessions', icon: LockKeyhole, visible: true },
    { id: 'team', label: 'Team access', icon: UsersRound, visible: Boolean(canManageMembers) },
    { id: 'audit', label: 'Audit trail', icon: ScrollText, visible: auditEnabled && Boolean(canManageMembers) }
  ]

  return (
    <div className="page settings-page">
      <div className="page-title">
        <div>
          <p className="eyebrow">WORKSPACE</p>
          <h1>Settings</h1>
          <p>Identity, access and security controls for your monitc workspace.</p>
        </div>
      </div>
      <div className="settings-grid">
        <aside>
          {tabs.filter((item) => item.visible).map(({ id, label, icon: Icon }) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
              <Icon size={15} /> {label}
            </button>
          ))}
        </aside>
        <div className="settings-content">
          {error && <p className="settings-notice error">{error}</p>}
          {message && <p className="settings-notice success">{message}</p>}

          {tab === 'profile' && (
            <section className="settings-section">
              <SectionHeader icon={UserRound} title="Profile" description="Your current account and workspace identity." />
              <div className="settings-fields">
                <label><span>Name</span><input value={user?.displayName || ''} disabled /></label>
                <label><span>Email</span><input value={user?.email || ''} disabled /></label>
                <label><span>Workspace</span><input value={workspace?.name || ''} disabled /></label>
                <label><span>Role</span><input value={workspace?.role || ''} disabled /></label>
              </div>
            </section>
          )}

          {tab === 'security' && (
            <>
              <section className="settings-section">
                <SectionHeader icon={ShieldCheck} title="Change password" description="Argon2id-protected credentials and automatic refresh-session revocation." />
                <form className="settings-fields password-settings" onSubmit={changePassword}>
                  <label><span>Current password</span><input type="password" autoComplete="current-password" required value={password.currentPassword} onChange={(event) => setPassword({ ...password, currentPassword: event.target.value })} /></label>
                  <label><span>New password</span><input type="password" autoComplete="new-password" minLength={12} required value={password.newPassword} onChange={(event) => setPassword({ ...password, newPassword: event.target.value })} /></label>
                  <button className="primary-button"><Save size={14} /> Update password</button>
                </form>
              </section>
              <section className="settings-section">
                <SectionHeader icon={KeyRound} title="Browser sessions" description="Review active refresh sessions and revoke access you no longer recognize." />
                <div className="security-session-list">
                  <header><span>{sessions.filter((session) => session.active).length} active</span><button className="text-button" onClick={() => void revokeOtherSessions()}>Revoke others</button></header>
                  {sessions.map((session) => (
                    <article key={session.id}>
                      <span className={`session-dot ${session.active ? 'active' : ''}`}><i /></span>
                      <div><strong>{session.current ? 'This browser' : 'Browser session'}</strong><small>Started {new Date(session.createdAt).toLocaleString()} · expires {new Date(session.expiresAt).toLocaleDateString()}</small></div>
                      <span className={`session-state ${session.active ? 'active' : ''}`}>{session.active ? 'Active' : 'Closed'}</span>
                      {session.active && <button className="icon-button danger" title="Revoke session" onClick={() => void revokeSession(session)}><Trash2 size={13} /></button>}
                    </article>
                  ))}
                </div>
              </section>
            </>
          )}

          {tab === 'team' && canManageMembers && (
            <section className="settings-section team-settings">
              <SectionHeader
                icon={UsersRound}
                title="Workspace access"
                description={`${members.length} of ${workspace?.plan.entitlements.seats ?? 'unlimited'} seats in use on the ${workspace?.plan.name} plan.`}
              />
              <form className="member-invite" onSubmit={addMember}>
                <label><span>Existing account email</span><input type="email" required placeholder="operator@company.com" value={invite.email} onChange={(event) => setInvite({ ...invite, email: event.target.value })} /></label>
                <label><span>Workspace role</span><select value={invite.role} onChange={(event) => setInvite({ ...invite, role: event.target.value as Member['role'] })}><option value="viewer">Viewer</option><option value="operator">Operator</option><option value="admin">Admin</option></select></label>
                <button className="primary-button"><Plus size={14} /> Add member</button>
              </form>
              <div className="member-list">
                {members.map((member) => (
                  <article key={member.userId}>
                    <span className="member-avatar">{member.displayName.slice(0, 1).toUpperCase()}</span>
                    <div><strong>{member.displayName}</strong><small>{member.email}</small></div>
                    {member.role === 'owner' ? (
                      <span className="owner-chip"><ShieldCheck size={11} /> Owner</span>
                    ) : (
                      <select value={member.role} onChange={(event) => void changeRole(member, event.target.value as Member['role'])}><option value="viewer">Viewer</option><option value="operator">Operator</option><option value="admin">Admin</option></select>
                    )}
                    {member.role !== 'owner' && member.userId !== user?.id && (
                      <button className={`remove-member ${confirmMember === member.userId ? 'confirm' : ''}`} onClick={() => void removeMember(member)}>
                        {confirmMember === member.userId ? 'Confirm remove' : <Trash2 size={13} />}
                      </button>
                    )}
                  </article>
                ))}
              </div>
            </section>
          )}

          {tab === 'audit' && auditEnabled && (
            <section className="settings-section audit-settings">
              <SectionHeader icon={ScrollText} title="Workspace audit trail" description="Recent identity, server, billing and policy changes." />
              <div className="workspace-audit-list">
                {auditEntries.map((entry) => (
                  <article key={entry.id}>
                    <span><i /></span>
                    <div><strong>{entry.action.replaceAll('.', ' / ')}</strong><small>{entry.actorEmail || 'System'} · {entry.resourceType}{entry.resourceId ? ` · ${entry.resourceId.slice(0, 12)}` : ''}</small></div>
                    <time>{new Date(entry.createdAt).toLocaleString()}</time>
                  </article>
                ))}
                {!auditEntries.length && <p className="settings-empty">No workspace changes have been recorded yet.</p>}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

function SectionHeader({
  icon: Icon,
  title,
  description
}: {
  icon: typeof UserRound
  title: string
  description: string
}) {
  return <header><span><Icon size={17} /></span><div><h2>{title}</h2><p>{description}</p></div></header>
}
