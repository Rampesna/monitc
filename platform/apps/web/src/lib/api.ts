import type { AuthSession } from '@monitc/shared'

const API_URL = (
  import.meta.env.VITE_API_URL ||
  (import.meta.env.DEV ? 'http://localhost:8080' : window.location.origin)
).replace(/\/$/, '')

let accessToken = ''
let refreshPromise: Promise<AuthSession | null> | null = null
const responseCache = new Map<string, { expiresAt: number; value?: unknown; pending?: Promise<unknown> }>()

export function apiOrigin(): string {
  return API_URL
}

export function setAccessToken(token: string): void {
  if (!token || !accessToken) responseCache.clear()
  accessToken = token
}

export function clearApiCache(prefix = ''): void {
  for (const key of responseCache.keys()) {
    if (!prefix || key.startsWith(prefix)) responseCache.delete(key)
  }
}

async function refresh(): Promise<AuthSession | null> {
  refreshPromise ??= fetch(`${API_URL}/api/v1/auth/refresh`, {
    method: 'POST',
    credentials: 'include'
  })
    .then(async (response) => {
      if (!response.ok) return null
      const session = (await response.json()) as AuthSession
      accessToken = session.accessToken
      return session
    })
    .finally(() => {
      refreshPromise = null
    })
  return refreshPromise
}

export async function restoreSession(): Promise<AuthSession | null> {
  return refresh()
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
  retry = true
): Promise<T> {
  const headers = new Headers(options.headers)
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`)
  if (options.body && !(options.body instanceof FormData)) headers.set('content-type', 'application/json')

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
    credentials: 'include'
  })
  if (response.status === 401 && retry && !path.includes('/auth/')) {
    const session = await refresh()
    if (session) return api<T>(path, options, false)
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string; code?: string; message?: string }
    throw new ApiError(response.status, body.code || body.error || 'request_failed', body.message || 'Request failed.')
  }
  if ((options.method || 'GET').toUpperCase() !== 'GET') clearApiCache()
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export function apiCached<T>(path: string, ttlMs = 5_000): Promise<T> {
  const now = Date.now()
  const cached = responseCache.get(path)
  if (cached?.value !== undefined && cached.expiresAt > now) return Promise.resolve(cached.value as T)
  if (cached?.pending) return cached.pending as Promise<T>
  const pending = api<T>(path).then((value) => {
    responseCache.set(path, { value, expiresAt: Date.now() + ttlMs })
    return value
  }).catch((error) => {
    responseCache.delete(path)
    throw error
  })
  responseCache.set(path, { expiresAt: now + ttlMs, pending })
  return pending
}

export async function apiBlob(path: string): Promise<Blob> {
  const headers = new Headers()
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`)
  let response = await fetch(`${API_URL}${path}`, { headers, credentials: 'include' })
  if (response.status === 401) {
    const session = await refresh()
    if (session) {
      headers.set('authorization', `Bearer ${session.accessToken}`)
      response = await fetch(`${API_URL}${path}`, { headers, credentials: 'include' })
    }
  }
  if (!response.ok) throw new ApiError(response.status, 'download_failed', 'Download failed.')
  return response.blob()
}

export function jsonBody(value: unknown): Pick<RequestInit, 'body'> {
  return { body: JSON.stringify(value) }
}
