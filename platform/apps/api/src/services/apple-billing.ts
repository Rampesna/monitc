import {
  Environment,
  SignedDataVerifier,
  type JWSRenewalInfoDecodedPayload,
  type JWSTransactionDecodedPayload,
  type ResponseBodyV2DecodedPayload
} from '@apple/app-store-server-library'
import { config } from '../config.js'
export {
  billingState,
  entitlementState,
  renewalEnabled,
  type BillingState
} from './billing-state.js'

export type AppleEnvironment = 'sandbox' | 'production'

export interface VerifiedAppleTransaction {
  environment: AppleEnvironment
  transaction: JWSTransactionDecodedPayload
}

export interface VerifiedAppleNotification {
  environment: AppleEnvironment
  notification: ResponseBodyV2DecodedPayload
  transaction?: JWSTransactionDecodedPayload
  renewal?: JWSRenewalInfoDecodedPayload
}

let sandboxVerifier: SignedDataVerifier | null = null
let productionVerifier: SignedDataVerifier | null = null

function rootCertificates(): Buffer[] {
  const values = config.APPLE_ROOT_CA_B64
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  if (!values.length) {
    throw Object.assign(new Error('Apple purchase verification is not configured.'), { statusCode: 503 })
  }
  return values.map((value) => Buffer.from(value, 'base64'))
}

function verifier(environment: AppleEnvironment): SignedDataVerifier {
  if (environment === 'sandbox') {
    sandboxVerifier ||= new SignedDataVerifier(
      rootCertificates(),
      true,
      Environment.SANDBOX,
      config.APPLE_BUNDLE_ID
    )
    return sandboxVerifier
  }

  const appAppleId = Number(config.APPLE_APP_ID)
  if (!Number.isSafeInteger(appAppleId) || appAppleId <= 0) {
    throw Object.assign(new Error('Production Apple purchase verification is not configured.'), { statusCode: 503 })
  }
  productionVerifier ||= new SignedDataVerifier(
    rootCertificates(),
    true,
    Environment.PRODUCTION,
    config.APPLE_BUNDLE_ID,
    appAppleId
  )
  return productionVerifier
}

export async function verifyAppleTransaction(signedTransactionInfo: string): Promise<VerifiedAppleTransaction> {
  let sandboxError: unknown
  try {
    return {
      environment: 'sandbox',
      transaction: await verifier('sandbox').verifyAndDecodeTransaction(signedTransactionInfo)
    }
  } catch (error) {
    sandboxError = error
  }

  try {
    return {
      environment: 'production',
      transaction: await verifier('production').verifyAndDecodeTransaction(signedTransactionInfo)
    }
  } catch (productionError) {
    if ((productionError as { statusCode?: number }).statusCode === 503) throw productionError
    throw Object.assign(new Error('The App Store transaction could not be verified.'), {
      statusCode: 422,
      cause: productionError || sandboxError
    })
  }
}

export async function verifyAppleNotification(signedPayload: string): Promise<VerifiedAppleNotification> {
  let sandboxError: unknown
  for (const environment of ['sandbox', 'production'] as const) {
    try {
      const activeVerifier = verifier(environment)
      const notification = await activeVerifier.verifyAndDecodeNotification(signedPayload)
      const transaction = notification.data?.signedTransactionInfo
        ? await activeVerifier.verifyAndDecodeTransaction(notification.data.signedTransactionInfo)
        : undefined
      const renewal = notification.data?.signedRenewalInfo
        ? await activeVerifier.verifyAndDecodeRenewalInfo(notification.data.signedRenewalInfo)
        : undefined
      return { environment, notification, transaction, renewal }
    } catch (error) {
      if (environment === 'sandbox') {
        sandboxError = error
        continue
      }
      if ((error as { statusCode?: number }).statusCode === 503) throw error
      throw Object.assign(new Error('The App Store notification could not be verified.'), {
        statusCode: 422,
        cause: error || sandboxError
      })
    }
  }
  throw Object.assign(new Error('The App Store notification could not be verified.'), { statusCode: 422 })
}
