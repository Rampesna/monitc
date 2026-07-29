import assert from 'node:assert/strict'
import test from 'node:test'
import { scopesFor } from './scopes.js'

test('bootstrap administrators have no privileged scopes before changing their password', () => {
  assert.deepEqual(scopesFor('owner', 'super_admin', true), [])
})

test('regular super administrators receive platform and workspace scopes', () => {
  const scopes = scopesFor('owner', 'super_admin')
  assert.ok(scopes.includes('platform:admin'))
  assert.ok(scopes.includes('workspace:manage'))
})
