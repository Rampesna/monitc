import {
  DescribeInstancesCommand,
  StartInstancesCommand,
  StopInstancesCommand,
  RebootInstancesCommand,
  DescribeSecurityGroupsCommand,
  type Instance,
  type Reservation
} from '@aws-sdk/client-ec2'
import { awsManager } from './aws-manager'

export interface EC2InstanceSummary {
  instanceId: string
  name: string
  state: string
  instanceType: string
  publicIp: string | null
  privateIp: string | null
  availabilityZone: string
  launchTime: string | null
  platform: string
  vpcId: string | null
}

export interface EC2InstanceDetails extends EC2InstanceSummary {
  securityGroups: { id: string; name: string }[]
  iamRole: string | null
  volumes: { id: string; device: string; size: number; type: string }[]
  subnetId: string | null
  keyName: string | null
  architecture: string
  monitoring: string
  tags: Record<string, string>
}

export interface SecurityGroupSummary {
  groupId: string
  groupName: string
  description: string
  vpcId: string | null
  inboundRuleCount: number
  outboundRuleCount: number
}

function getTagValue(instance: Instance, key: string): string {
  return instance.Tags?.find((t) => t.Key === key)?.Value ?? ''
}

function mapInstance(instance: Instance): EC2InstanceSummary {
  return {
    instanceId:       instance.InstanceId ?? '',
    name:             getTagValue(instance, 'Name'),
    state:            instance.State?.Name ?? 'unknown',
    instanceType:     instance.InstanceType ?? '',
    publicIp:         instance.PublicIpAddress ?? null,
    privateIp:        instance.PrivateIpAddress ?? null,
    availabilityZone: instance.Placement?.AvailabilityZone ?? '',
    launchTime:       instance.LaunchTime?.toISOString() ?? null,
    platform:         instance.PlatformDetails ?? instance.Platform ?? 'linux',
    vpcId:            instance.VpcId ?? null
  }
}

/**
 * List all EC2 instances across all pages.
 */
export async function listInstances(accountId: string): Promise<EC2InstanceSummary[]> {
  const client = awsManager.getEC2Client(accountId)
  const instances: EC2InstanceSummary[] = []
  let nextToken: string | undefined

  do {
    const response = await client.send(new DescribeInstancesCommand({ NextToken: nextToken }))
    for (const reservation of (response.Reservations ?? []) as Reservation[]) {
      for (const instance of reservation.Instances ?? []) {
        instances.push(mapInstance(instance))
      }
    }
    nextToken = response.NextToken
  } while (nextToken)

  return instances
}

/**
 * Get full details for a single EC2 instance.
 */
export async function getInstanceDetails(accountId: string, instanceId: string): Promise<EC2InstanceDetails> {
  const client = awsManager.getEC2Client(accountId)
  const response = await client.send(new DescribeInstancesCommand({
    InstanceIds: [instanceId]
  }))

  const instance = response.Reservations?.[0]?.Instances?.[0]
  if (!instance) throw new Error(`Instance ${instanceId} not found`)

  const tags: Record<string, string> = {}
  for (const tag of instance.Tags ?? []) {
    if (tag.Key && tag.Value) tags[tag.Key] = tag.Value
  }

  return {
    ...mapInstance(instance),
    securityGroups: (instance.SecurityGroups ?? []).map((sg) => ({
      id:   sg.GroupId ?? '',
      name: sg.GroupName ?? ''
    })),
    iamRole:      instance.IamInstanceProfile?.Arn ?? null,
    volumes: (instance.BlockDeviceMappings ?? []).map((bdm) => ({
      id:     bdm.Ebs?.VolumeId ?? '',
      device: bdm.DeviceName ?? '',
      size:   0, // Size requires a separate DescribeVolumes call
      type:   ''
    })),
    subnetId:     instance.SubnetId ?? null,
    keyName:      instance.KeyName ?? null,
    architecture: instance.Architecture ?? '',
    monitoring:   instance.Monitoring?.State ?? 'disabled',
    tags
  }
}

export async function startInstance(accountId: string, instanceId: string): Promise<void> {
  const client = awsManager.getEC2Client(accountId)
  await client.send(new StartInstancesCommand({ InstanceIds: [instanceId] }))
}

export async function stopInstance(accountId: string, instanceId: string): Promise<void> {
  const client = awsManager.getEC2Client(accountId)
  await client.send(new StopInstancesCommand({ InstanceIds: [instanceId] }))
}

export async function rebootInstance(accountId: string, instanceId: string): Promise<void> {
  const client = awsManager.getEC2Client(accountId)
  await client.send(new RebootInstancesCommand({ InstanceIds: [instanceId] }))
}

/**
 * List all security groups with rule counts.
 */
export async function listSecurityGroups(accountId: string): Promise<SecurityGroupSummary[]> {
  const client = awsManager.getEC2Client(accountId)
  const groups: SecurityGroupSummary[] = []
  let nextToken: string | undefined

  do {
    const response = await client.send(new DescribeSecurityGroupsCommand({ NextToken: nextToken }))
    for (const sg of response.SecurityGroups ?? []) {
      groups.push({
        groupId:          sg.GroupId ?? '',
        groupName:        sg.GroupName ?? '',
        description:      sg.Description ?? '',
        vpcId:            sg.VpcId ?? null,
        inboundRuleCount: sg.IpPermissions?.length ?? 0,
        outboundRuleCount: sg.IpPermissionsEgress?.length ?? 0
      })
    }
    nextToken = response.NextToken
  } while (nextToken)

  return groups
}
