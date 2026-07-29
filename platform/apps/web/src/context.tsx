import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AuthSession, PublicUser, WorkspaceSummary } from '@monitc/shared'
import { api, jsonBody, restoreSession, setAccessToken } from './lib/api'

interface AuthState {
  ready: boolean
  user: PublicUser | null
  workspace: WorkspaceSummary | null
  login(email: string, password: string): Promise<void>
  register(input: {
    email: string
    password: string
    displayName: string
    workspaceName: string
  }): Promise<void>
  logout(): Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [user, setUser] = useState<PublicUser | null>(null)
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null)

  const accept = (session: AuthSession | null): void => {
    if (session) {
      setAccessToken(session.accessToken)
      setUser(session.user)
      setWorkspace(session.workspace)
    } else {
      setAccessToken('')
      setUser(null)
      setWorkspace(null)
    }
  }

  useEffect(() => {
    restoreSession()
      .then(accept)
      .catch(() => accept(null))
      .finally(() => setReady(true))
  }, [])

  const value = useMemo<AuthState>(() => ({
    ready,
    user,
    workspace,
    async login(email, password) {
      const session = await api<AuthSession>('/api/v1/auth/login', {
        method: 'POST',
        ...jsonBody({ email, password })
      })
      accept(session)
    },
    async register(input) {
      const session = await api<AuthSession>('/api/v1/auth/register', {
        method: 'POST',
        ...jsonBody(input)
      })
      accept(session)
    },
    async logout() {
      await api('/api/v1/auth/logout', { method: 'POST' })
      accept(null)
    }
  }), [ready, user, workspace])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
