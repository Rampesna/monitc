import assert from 'node:assert/strict'
import test from 'node:test'
import { parseCpuMillicores, parseMemoryBytes, percent } from './resource-units.js'

test('parses Kubernetes CPU quantities into millicores', () => {
  assert.equal(parseCpuMillicores('250m'), 250)
  assert.equal(parseCpuMillicores('125000000n'), 125)
  assert.equal(parseCpuMillicores('2'), 2000)
})

test('parses Kubernetes memory quantities into bytes', () => {
  assert.equal(parseMemoryBytes('128Mi'), 128 * 1024 ** 2)
  assert.equal(parseMemoryBytes('2Gi'), 2 * 1024 ** 3)
})

test('returns a stable percentage only when capacity is assigned', () => {
  assert.equal(percent(250, 500), 50)
  assert.equal(percent(10, 0), null)
})
