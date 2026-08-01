import assert from 'node:assert/strict'
import test from 'node:test'
import { AutoRenewStatus, Status } from '@apple/app-store-server-library'
import { billingState, entitlementState, renewalEnabled } from './billing-state.js'

test('maps App Store subscription states without trusting the client', () => {
  const future = Date.now() + 60_000
  const past = Date.now() - 60_000
  assert.equal(billingState({ expiresDate: future }, Status.ACTIVE), 'active')
  assert.equal(billingState({ expiresDate: future }, Status.BILLING_GRACE_PERIOD), 'grace_period')
  assert.equal(billingState({ expiresDate: future }, Status.BILLING_RETRY), 'billing_retry')
  assert.equal(billingState({ expiresDate: past }), 'expired')
  assert.equal(billingState({ expiresDate: future, revocationDate: Date.now(), revocationReason: 1 }), 'refunded')
})

test('normalizes transaction-only states into entitlement states', () => {
  assert.equal(entitlementState('refunded'), 'revoked')
  assert.equal(entitlementState('grace_period'), 'grace_period')
})

test('uses verified renewal information for auto-renew state', () => {
  assert.equal(renewalEnabled({ autoRenewStatus: AutoRenewStatus.ON }), true)
  assert.equal(renewalEnabled({ autoRenewStatus: AutoRenewStatus.OFF }), false)
})
