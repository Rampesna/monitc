import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeWorkloadCommandError } from '../lib/workload-error.js'

test('maps Docker workload churn to a safe not-found response', () => {
  const source = new Error('Error: No such object: deleted-container')
  const normalized = normalizeWorkloadCommandError(source) as Error & { statusCode?: number }

  assert.equal(normalized.statusCode, 404)
  assert.equal(normalized.message, 'This workload no longer exists on the server. Refresh the workload list and try again.')
  assert.equal(normalized.cause, source)
})

test('preserves unrelated SSH command failures', () => {
  const source = new Error('Permission denied')
  assert.equal(normalizeWorkloadCommandError(source), source)
})
