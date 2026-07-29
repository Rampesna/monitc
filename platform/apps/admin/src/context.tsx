import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AuthSession, PublicUser, WorkspaceSummary } from '@monitc/shared'
import { api, json, restore, setToken } from './lib/api'

interface AuthValue {
  ready: boolean
  user: PublicUser | null
  workspace: WorkspaceSummary | null
  login(email: string, password: string): Promise<void>
  logout(): Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [user, setUser] = useState<PublicUser | null>(null)
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null)
  const accept = (session: AuthSession | null) => {
    if (!session || session.user.globalRole !== 'super_admin') {
      setToken('')
      setUser(null)
      setWorkspace(null)
      return
    }
    setToken(session.accessToken)
    setUser(session.user)
    setWorkspace(session.workspace)
  }
  useEffect(() => {
    void restore()
      .then(accept)
      .catch(() => accept(null))
      .finally(() => setReady(true))
  }, [])
  const value = useMemo<AuthValue>(() => ({
    ready,
    user,
    workspace,
    async login(email, password) {
      const session = await api<AuthSession>('/api/v1/auth/login', { method: 'POST', ...json({ email, password }) }, false)
      if (session.user.globalRole !== 'super_admin') {
        await api('/api/v1/auth/logout', { method: 'POST' })
        throw new Error('This account does not have platform administrator access.')
      }
      accept(session)
    },
    async logout() {
      await api('/api/v1/auth/logout', { method: 'POST' })
      accept(null)
    }
  }), [ready, user, workspace])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('Auth context is missing')
  return value
}
