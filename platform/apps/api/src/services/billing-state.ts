import {
  AutoRenewStatus,
  Status,
  type JWSRenewalInfoDecodedPayload,
  type JWSTransactionDecodedPayload
} from '@apple/app-store-server-library'

export type BillingState = 'active' | 'grace_period' | 'billing_retry' | 'expired' | 'revoked' | 'refunded'

export function billingState(
  transaction: JWSTransactionDecodedPayload,
  subscriptionStatus?: Status | number
): BillingState {
  if (transaction.revocationDate) return transaction.revocationReason === undefined ? 'revoked' : 'refunded'
  switch (subscriptionStatus) {
    case Status.ACTIVE: return 'active'
    case Status.BILLING_GRACE_PERIOD: return 'grace_period'
    case Status.BILLING_RETRY: return 'billing_retry'
    case Status.REVOKED: return 'revoked'
    case Status.EXPIRED: return 'expired'
    default:
      return transaction.expiresDate && transaction.expiresDate <= Date.now() ? 'expired' : 'active'
  }
}

export function entitlementState(state: BillingState): 'active' | 'grace_period' | 'billing_retry' | 'expired' | 'revoked' {
  return state === 'refunded' ? 'revoked' : state
}

export function renewalEnabled(renewal?: JWSRenewalInfoDecodedPayload): boolean {
  return renewal ? renewal.autoRenewStatus === AutoRenewStatus.ON : true
}
