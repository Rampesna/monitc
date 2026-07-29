import { setTimeout as wait } from 'node:timers/promises'

interface StartupRetryOptions {
  attempts?: number
  initialDelayMs?: number
  maxDelayMs?: number
}

export async function withStartupRetry<T>(
  label: string,
  operation: () => Promise<T>,
  options: StartupRetryOptions = {}
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 12)
  const initialDelayMs = Math.max(100, options.initialDelayMs ?? 1_000)
  const maxDelayMs = Math.max(initialDelayMs, options.maxDelayMs ?? 10_000)

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      if (attempt === attempts) throw error

      const delayMs = Math.min(maxDelayMs, initialDelayMs * 2 ** (attempt - 1))
      const message = error instanceof Error ? error.message : String(error)
      console.warn(
        `[startup] ${label} failed (${attempt}/${attempts}): ${message}; retrying in ${delayMs}ms`
      )
      await wait(delayMs)
    }
  }

  throw new Error(`${label} exhausted its startup retries`)
}
