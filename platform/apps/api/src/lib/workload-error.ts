export function normalizeWorkloadCommandError(error: unknown): unknown {
  const message = error instanceof Error ? error.message : String(error)
  if (!/no such (?:object|container)|\bnotfound\b|\bnot found\b/i.test(message)) return error
  const unavailable = new Error(
    'This workload no longer exists on the server. Refresh the workload list and try again.',
    { cause: error }
  ) as Error & { statusCode: number }
  unavailable.statusCode = 404
  return unavailable
}
