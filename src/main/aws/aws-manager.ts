import { EC2Client } from '@aws-sdk/client-ec2'
import { EKSClient } from '@aws-sdk/client-eks'
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch'
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts'
import type { AwsAccount } from '../store/types'

const VALID_REGIONS = [
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
  'af-south-1', 'ap-east-1', 'ap-south-1', 'ap-south-2',
  'ap-southeast-1', 'ap-southeast-2', 'ap-southeast-3', 'ap-southeast-4',
  'ap-northeast-1', 'ap-northeast-2', 'ap-northeast-3',
  'ca-central-1', 'ca-west-1',
  'eu-central-1', 'eu-central-2', 'eu-west-1', 'eu-west-2', 'eu-west-3',
  'eu-south-1', 'eu-south-2', 'eu-north-1',
  'il-central-1', 'me-south-1', 'me-central-1',
  'sa-east-1'
]

interface ClientCache {
  ec2: EC2Client | null
  eks: EKSClient | null
  cloudwatch: CloudWatchClient | null
}

/**
 * Manages AWS SDK clients for registered accounts.
 * Single instance per account ID; clients are lazily initialized.
 */
class AwsManager {
  private clients = new Map<string, ClientCache>()
  private accounts = new Map<string, AwsAccount>()

  registerAccount(account: AwsAccount): void {
    this.validateRegion(account.region)
    this.accounts.set(account.id, account)
  }

  unregisterAccount(accountId: string): void {
    this.destroyClients(accountId)
    this.accounts.delete(accountId)
  }

  /** Clear cached clients when credentials are updated */
  invalidateClients(accountId: string): void {
    this.destroyClients(accountId)
  }

  getEC2Client(accountId: string): EC2Client {
    const cache = this.getOrCreateCache(accountId)
    if (!cache.ec2) {
      const account = this.getAccount(accountId)
      cache.ec2 = new EC2Client({
        region: account.region,
        credentials: {
          accessKeyId: account.accessKeyId,
          secretAccessKey: account.secretAccessKey
        }
      })
    }
    return cache.ec2
  }

  getEKSClient(accountId: string): EKSClient {
    const cache = this.getOrCreateCache(accountId)
    if (!cache.eks) {
      const account = this.getAccount(accountId)
      cache.eks = new EKSClient({
        region: account.region,
        credentials: {
          accessKeyId: account.accessKeyId,
          secretAccessKey: account.secretAccessKey
        }
      })
    }
    return cache.eks
  }

  getCloudWatchClient(accountId: string): CloudWatchClient {
    const cache = this.getOrCreateCache(accountId)
    if (!cache.cloudwatch) {
      const account = this.getAccount(accountId)
      cache.cloudwatch = new CloudWatchClient({
        region: account.region,
        credentials: {
          accessKeyId: account.accessKeyId,
          secretAccessKey: account.secretAccessKey
        }
      })
    }
    return cache.cloudwatch
  }

  /**
   * Validate credentials by calling STS GetCallerIdentity.
   * Returns the resolved AWS Account ID and ARN if successful.
   */
  async testCredentials(account: AwsAccount): Promise<{ accountId: string; arn: string; userId: string }> {
    this.validateRegion(account.region)
    const sts = new STSClient({
      region: account.region,
      credentials: {
        accessKeyId: account.accessKeyId,
        secretAccessKey: account.secretAccessKey
      }
    })
    try {
      const response = await sts.send(new GetCallerIdentityCommand({}))
      return {
        accountId: response.Account ?? '',
        arn: response.Arn ?? '',
        userId: response.UserId ?? ''
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`AWS credential validation failed: ${msg}`)
    } finally {
      sts.destroy()
    }
  }

  validateRegion(region: string): void {
    if (!VALID_REGIONS.includes(region)) {
      throw new Error(`Invalid AWS region: "${region}". Must be one of: ${VALID_REGIONS.join(', ')}`)
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private getAccount(accountId: string): AwsAccount {
    const account = this.accounts.get(accountId)
    if (!account) throw new Error(`AWS account "${accountId}" not registered`)
    return account
  }

  private getOrCreateCache(accountId: string): ClientCache {
    let cache = this.clients.get(accountId)
    if (!cache) {
      cache = { ec2: null, eks: null, cloudwatch: null }
      this.clients.set(accountId, cache)
    }
    return cache
  }

  private destroyClients(accountId: string): void {
    const cache = this.clients.get(accountId)
    if (!cache) return
    cache.ec2?.destroy()
    cache.eks?.destroy()
    cache.cloudwatch?.destroy()
    this.clients.delete(accountId)
  }
}

export const awsManager = new AwsManager()
