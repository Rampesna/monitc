import { ipcMain } from 'electron'
import crypto from 'crypto'
import { loadData, saveData } from '../store/store'
import { awsManager } from '../aws/aws-manager'
import { listInstances, getInstanceDetails, startInstance, stopInstance, rebootInstance, listSecurityGroups } from '../aws/ec2-commands'
import { listClusters, describeCluster, listNodeGroups, generateKubeconfig } from '../aws/eks-commands'
import { getEC2Metrics } from '../aws/cloudwatch-commands'
import type { AwsAccount } from '../store/types'

/**
 * Register all AWS-related IPC handlers.
 * Call this once from the main IPC registration file.
 *
 * IPC Channel Surface:
 *
 * ── Account management ──────────────────────────────────────────────────────
 * aws:accounts:list                          → AwsAccount[] (credentials redacted)
 * aws:accounts:add(account)                  → AwsAccount
 * aws:accounts:update(account)               → AwsAccount
 * aws:accounts:remove(accountId)             → boolean
 * aws:accounts:test(account)                 → { accountId, arn, userId }
 *
 * ── EC2 ─────────────────────────────────────────────────────────────────────
 * aws:ec2:instances:list(accountId)          → EC2InstanceSummary[]
 * aws:ec2:instance:start(accountId, id)      → { success }
 * aws:ec2:instance:stop(accountId, id)       → { success }
 * aws:ec2:instance:reboot(accountId, id)     → { success }
 * aws:ec2:instance:details(accountId, id)    → EC2InstanceDetails
 * aws:ec2:security-groups:list(accountId)    → SecurityGroupSummary[]
 *
 * ── EKS ─────────────────────────────────────────────────────────────────────
 * aws:eks:clusters:list(accountId)           → EKSClusterSummary[]
 * aws:eks:cluster:describe(accountId, name)  → EKSClusterDetails
 * aws:eks:nodegroups:list(accountId, name)   → EKSNodeGroup[]
 * aws:eks:kubeconfig:generate(accountId, n)  → string (YAML)
 *
 * ── CloudWatch ──────────────────────────────────────────────────────────────
 * aws:cloudwatch:ec2:metrics(accountId, instanceId, metricName, hours) → MetricDataPoint[]
 */
export function registerAwsIpcHandlers(): void {
  // ── Account management ──────────────────────────────────────────────────

  ipcMain.handle('aws:accounts:list', () => {
    const data = loadData()
    // Return accounts with credentials redacted for display
    return (data.awsAccounts ?? []).map((a) => ({
      ...a,
      accessKeyId:     maskKey(a.accessKeyId),
      secretAccessKey: '••••••••'
    }))
  })

  ipcMain.handle('aws:accounts:add', async (_, account: Omit<AwsAccount, 'id' | 'createdAt'>) => {
    const data = loadData()
    const newAccount: AwsAccount = {
      ...account,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString()
    }
    awsManager.registerAccount(newAccount)
    if (!data.awsAccounts) data.awsAccounts = []
    data.awsAccounts.push(newAccount)
    saveData(data)
    return { ...newAccount, accessKeyId: maskKey(newAccount.accessKeyId), secretAccessKey: '••••••••' }
  })

  ipcMain.handle('aws:accounts:update', async (_, account: AwsAccount) => {
    const data = loadData()
    const idx = (data.awsAccounts ?? []).findIndex((a) => a.id === account.id)
    if (idx === -1) throw new Error(`AWS account "${account.id}" not found`)
    data.awsAccounts[idx] = account
    saveData(data)
    awsManager.invalidateClients(account.id)
    awsManager.registerAccount(account)
    return { ...account, accessKeyId: maskKey(account.accessKeyId), secretAccessKey: '••••••••' }
  })

  ipcMain.handle('aws:accounts:remove', async (_, accountId: string) => {
    const data = loadData()
    data.awsAccounts = (data.awsAccounts ?? []).filter((a) => a.id !== accountId)
    saveData(data)
    awsManager.unregisterAccount(accountId)
    return true
  })

  ipcMain.handle('aws:accounts:test', async (_, account: Pick<AwsAccount, 'accessKeyId' | 'secretAccessKey' | 'region'>) => {
    return awsManager.testCredentials({
      id: 'test',
      name: 'test',
      createdAt: '',
      ...account
    })
  })

  // ── EC2 ─────────────────────────────────────────────────────────────────

  ipcMain.handle('aws:ec2:instances:list', async (_, accountId: string) => {
    ensureRegistered(accountId)
    return listInstances(accountId)
  })

  ipcMain.handle('aws:ec2:instance:start', async (_, accountId: string, instanceId: string) => {
    ensureRegistered(accountId)
    await startInstance(accountId, instanceId)
    return { success: true }
  })

  ipcMain.handle('aws:ec2:instance:stop', async (_, accountId: string, instanceId: string) => {
    ensureRegistered(accountId)
    await stopInstance(accountId, instanceId)
    return { success: true }
  })

  ipcMain.handle('aws:ec2:instance:reboot', async (_, accountId: string, instanceId: string) => {
    ensureRegistered(accountId)
    await rebootInstance(accountId, instanceId)
    return { success: true }
  })

  ipcMain.handle('aws:ec2:instance:details', async (_, accountId: string, instanceId: string) => {
    ensureRegistered(accountId)
    return getInstanceDetails(accountId, instanceId)
  })

  ipcMain.handle('aws:ec2:security-groups:list', async (_, accountId: string) => {
    ensureRegistered(accountId)
    return listSecurityGroups(accountId)
  })

  // ── EKS ─────────────────────────────────────────────────────────────────

  ipcMain.handle('aws:eks:clusters:list', async (_, accountId: string) => {
    ensureRegistered(accountId)
    return listClusters(accountId)
  })

  ipcMain.handle('aws:eks:cluster:describe', async (_, accountId: string, clusterName: string) => {
    ensureRegistered(accountId)
    return describeCluster(accountId, clusterName)
  })

  ipcMain.handle('aws:eks:nodegroups:list', async (_, accountId: string, clusterName: string) => {
    ensureRegistered(accountId)
    return listNodeGroups(accountId, clusterName)
  })

  ipcMain.handle('aws:eks:kubeconfig:generate', async (_, accountId: string, clusterName: string) => {
    const account = getFullAccount(accountId)
    return generateKubeconfig(account, clusterName)
  })

  // ── CloudWatch ──────────────────────────────────────────────────────────

  ipcMain.handle('aws:cloudwatch:ec2:metrics', async (_, accountId: string, instanceId: string, metricName: string, hours: number) => {
    ensureRegistered(accountId)
    return getEC2Metrics(accountId, instanceId, metricName, hours)
  })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Ensures the account is registered in the manager (loads from disk if needed). */
function ensureRegistered(accountId: string): void {
  try {
    awsManager.getEC2Client(accountId)
  } catch {
    const account = getFullAccount(accountId)
    awsManager.registerAccount(account)
  }
}

/** Retrieve the full account object (with credentials) from the store. */
function getFullAccount(accountId: string): AwsAccount {
  const data = loadData()
  const account = (data.awsAccounts ?? []).find((a) => a.id === accountId)
  if (!account) throw new Error(`AWS account "${accountId}" not found`)
  return account
}

/** Mask an access key for display: show first 4 and last 4 chars. */
function maskKey(key: string): string {
  if (key.length <= 8) return '••••••••'
  return key.slice(0, 4) + '••••••••' + key.slice(-4)
}
