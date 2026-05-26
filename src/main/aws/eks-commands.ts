import {
  ListClustersCommand,
  DescribeClusterCommand,
  ListNodegroupsCommand,
  DescribeNodegroupCommand
} from '@aws-sdk/client-eks'
import { awsManager } from './aws-manager'
import type { AwsAccount } from '../store/types'

export interface EKSClusterSummary {
  name: string
  status: string
  version: string
  endpoint: string
  roleArn: string
  platformVersion: string
  createdAt: string | null
}

export interface EKSClusterDetails extends EKSClusterSummary {
  certificateAuthority: string
  vpcId: string | null
  subnetIds: string[]
  securityGroupIds: string[]
  publicAccess: boolean
  privateAccess: boolean
  serviceIpv4Cidr: string | null
  tags: Record<string, string>
}

export interface EKSNodeGroup {
  name: string
  status: string
  instanceTypes: string[]
  desiredSize: number
  minSize: number
  maxSize: number
  capacityType: string
  amiType: string
  diskSize: number
  labels: Record<string, string>
}

/**
 * List all EKS cluster names in the account, then describe each to return summaries.
 */
export async function listClusters(accountId: string): Promise<EKSClusterSummary[]> {
  const client = awsManager.getEKSClient(accountId)
  const clusterNames: string[] = []
  let nextToken: string | undefined

  do {
    const response = await client.send(new ListClustersCommand({ nextToken }))
    clusterNames.push(...(response.clusters ?? []))
    nextToken = response.nextToken
  } while (nextToken)

  const clusters: EKSClusterSummary[] = []
  for (const name of clusterNames) {
    const desc = await client.send(new DescribeClusterCommand({ name }))
    const c = desc.cluster
    if (!c) continue
    clusters.push({
      name:            c.name ?? name,
      status:          c.status ?? 'UNKNOWN',
      version:         c.version ?? '',
      endpoint:        c.endpoint ?? '',
      roleArn:         c.roleArn ?? '',
      platformVersion: c.platformVersion ?? '',
      createdAt:       c.createdAt?.toISOString() ?? null
    })
  }

  return clusters
}

/**
 * Full cluster details including networking and certificate authority.
 */
export async function describeCluster(accountId: string, clusterName: string): Promise<EKSClusterDetails> {
  const client = awsManager.getEKSClient(accountId)
  const response = await client.send(new DescribeClusterCommand({ name: clusterName }))
  const c = response.cluster
  if (!c) throw new Error(`EKS cluster "${clusterName}" not found`)

  return {
    name:                 c.name ?? clusterName,
    status:               c.status ?? 'UNKNOWN',
    version:              c.version ?? '',
    endpoint:             c.endpoint ?? '',
    roleArn:              c.roleArn ?? '',
    platformVersion:      c.platformVersion ?? '',
    createdAt:            c.createdAt?.toISOString() ?? null,
    certificateAuthority: c.certificateAuthority?.data ?? '',
    vpcId:                c.resourcesVpcConfig?.vpcId ?? null,
    subnetIds:            c.resourcesVpcConfig?.subnetIds ?? [],
    securityGroupIds:     c.resourcesVpcConfig?.securityGroupIds ?? [],
    publicAccess:         c.resourcesVpcConfig?.endpointPublicAccess ?? true,
    privateAccess:        c.resourcesVpcConfig?.endpointPrivateAccess ?? false,
    serviceIpv4Cidr:      c.kubernetesNetworkConfig?.serviceIpv4Cidr ?? null,
    tags:                 (c.tags ?? {}) as Record<string, string>
  }
}

/**
 * List node groups for a given EKS cluster with capacity info.
 */
export async function listNodeGroups(accountId: string, clusterName: string): Promise<EKSNodeGroup[]> {
  const client = awsManager.getEKSClient(accountId)
  const names: string[] = []
  let nextToken: string | undefined

  do {
    const response = await client.send(new ListNodegroupsCommand({ clusterName, nextToken }))
    names.push(...(response.nodegroups ?? []))
    nextToken = response.nextToken
  } while (nextToken)

  const groups: EKSNodeGroup[] = []
  for (const name of names) {
    const desc = await client.send(new DescribeNodegroupCommand({ clusterName, nodegroupName: name }))
    const ng = desc.nodegroup
    if (!ng) continue
    groups.push({
      name:          ng.nodegroupName ?? name,
      status:        ng.status ?? 'UNKNOWN',
      instanceTypes: ng.instanceTypes ?? [],
      desiredSize:   ng.scalingConfig?.desiredSize ?? 0,
      minSize:       ng.scalingConfig?.minSize ?? 0,
      maxSize:       ng.scalingConfig?.maxSize ?? 0,
      capacityType:  ng.capacityType ?? 'ON_DEMAND',
      amiType:       ng.amiType ?? '',
      diskSize:      ng.diskSize ?? 0,
      labels:        (ng.labels ?? {}) as Record<string, string>
    })
  }

  return groups
}

/**
 * Generate a kubeconfig YAML string for the specified EKS cluster.
 * Can be used with kubectl or exported as Base64 for CI/CD.
 */
export async function generateKubeconfig(account: AwsAccount, clusterName: string): Promise<string> {
  const client = awsManager.getEKSClient(account.id)
  const response = await client.send(new DescribeClusterCommand({ name: clusterName }))
  const cluster = response.cluster
  if (!cluster) throw new Error(`EKS cluster "${clusterName}" not found`)

  const endpoint = cluster.endpoint ?? ''
  const caData   = cluster.certificateAuthority?.data ?? ''

  return `apiVersion: v1
kind: Config
clusters:
- cluster:
    server: ${endpoint}
    certificate-authority-data: ${caData}
  name: ${clusterName}
contexts:
- context:
    cluster: ${clusterName}
    user: ${clusterName}-user
  name: ${clusterName}
current-context: ${clusterName}
users:
- name: ${clusterName}-user
  user:
    exec:
      apiVersion: client.authentication.k8s.io/v1beta1
      command: aws
      args:
        - eks
        - get-token
        - --cluster-name
        - ${clusterName}
        - --region
        - ${account.region}
      env:
        - name: AWS_ACCESS_KEY_ID
          value: ${account.accessKeyId}
        - name: AWS_SECRET_ACCESS_KEY
          value: ${account.secretAccessKey}
`
}
