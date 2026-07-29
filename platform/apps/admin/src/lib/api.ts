import type { AuthSession } from '@monitc/shared'

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8080').replace(/\/$/, '')
let token = ''
let refreshing: Promise<AuthSession | null> | null = null

export function setToken(value: string): void {
  token = value
}

export async function restore(): Promise<AuthSession | null> {
  refreshing ??= fetch(`${API_URL}/api/v1/auth/refresh`, {
    method: 'POST',
    credentials: 'include'
  }).then(async (response) => {
    if (!response.ok) return null
    const session = await response.json() as AuthSession
    token = session.accessToken
    return session
  }).finally(() => { refreshing = null })
  return refreshing
}

export async function api<T>(path: string, options: RequestInit = {}, retry = true): Promise<T> {
  const headers = new Headers(options.headers)
  if (token) headers.set('authorization', `Bearer ${token}`)
  if (options.body && !(options.body instanceof FormData)) headers.set('content-type', 'application/json')
  const response = await fetch(`${API_URL}${path}`, { ...options, headers, credentials: 'include' })
  if (response.status === 401 && retry) {
    const session = await restore()
    if (session) return api<T>(path, options, false)
  }
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { message?: string }
    throw new Error(error.message || 'The operation failed.')
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export function json(value: unknown): Pick<RequestInit, 'body'> {
  return { body: JSON.stringify(value) }
}
