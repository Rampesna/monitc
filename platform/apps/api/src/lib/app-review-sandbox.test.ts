import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isAppReviewSandbox,
  reviewContainerInspection,
  reviewContainerLogs,
  reviewPodDescription,
  reviewPodLogs
} from './app-review-sandbox.js'

test('only enables the isolated review workspace without an SSH secret', () => {
  const base = { workspaceId: 'review', configuredWorkspaceId: 'review', hasSshSecret: false }
  assert.equal(isAppReviewSandbox(base), true)
  assert.equal(isAppReviewSandbox({ ...base, workspaceId: 'customer' }), false)
  assert.equal(isAppReviewSandbox({ ...base, configuredWorkspaceId: '' }), false)
  assert.equal(isAppReviewSandbox({ ...base, hasSshSecret: true }), false)
})

test('returns deterministic safe workload content for App Review', () => {
  assert.match(reviewContainerLogs('monitc-api'), /service healthy/)
  assert.equal(reviewContainerInspection('redis-0').state && typeof reviewContainerInspection('redis-0').state, 'object')
  assert.match(reviewPodLogs('production', 'monitc-api-7f8d9'), /serving traffic/)
  assert.match(reviewPodDescription('production', 'monitc-api-7f8d9'), /Status:\s+Running/)
})
