import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isAppReviewSandbox,
  reviewMetricPoints,
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

test('returns fresh bounded review metrics without touching production infrastructure', () => {
  const now = Date.parse('2026-08-02T08:00:00.000Z')
  const points = reviewMetricPoints(60, now)
  assert.equal(points.length, 60)
  assert.equal(points.at(-1)?.timestamp, '2026-08-02T08:00:00.000Z')
  assert.equal(points[0]?.timestamp, '2026-08-02T07:01:00.000Z')
  assert.ok((points.at(-1)?.cpuPercent || 0) > 0)
  assert.ok((points.at(-1)?.networkRxBytesPerSecond || 0) > 0)
  assert.ok(reviewMetricPoints(500, now).length <= 180)
})
