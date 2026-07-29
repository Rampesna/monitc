import { EventEmitter } from 'events'
import { sshManager } from '../ssh/ssh-manager'
import { COMMANDS } from '../ssh/ssh-commands'
import type { K8sPod, K8sService, K8sDeployment, K8sEvent } from '../store/types'

export interface KubernetesData {
  serverId: string
  available: boolean
  pods: K8sPod[]
  services: K8sService[]
  deployments: K8sDeployment[]
  events: K8sEvent[]
}

interface PodMetricsItem {
  metadata?: { namespace?: string; name?: string }
  containers?: Array<{ usage?: { cpu?: string; memory?: string } }>
}

interface PodStatsSummary {
  pods?: Array<{
    podRef?: { namespace?: string; name?: string }
    network?: { rxBytes?: number; txBytes?: number }
  }>
}

interface PodNetworkTotal {
  rx: number
  tx: number
}

interface PodResourceTotals {
  cpuRequest: number
  cpuLimit: number
  memoryRequest: number
  memoryLimit: number
}

function parseCpuMillicores(value: string | undefined): number {
  if (!value) return 0
  const match = value.match(/^([0-9.]+)(n|u|m)?$/)
  if (!match) return 0
  const amount = Number(match[1])
  if (match[2] === 'n') return amount / 1_000_000
  if (match[2] === 'u') return amount / 1_000
  if (match[2] === 'm') return amount
  return amount * 1_000
}

function parseMemoryBytes(value: string | undefined): number {
  if (!value) return 0
  const match = value.match(/^([0-9.]+)(Ki|Mi|Gi|Ti|K|M|G)?$/)
  if (!match) return 0
  const factors: Record<string, number> = {
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
    K: 1000,
    M: 1000 ** 2,
    G: 1000 ** 3,
    '': 1
  }
  return Number(match[1]) * (factors[match[2] || ''] || 1)
}

function usagePercent(usage: number, assigned: number): number | null {
  if (assigned <= 0) return null
  return Math.round((usage / assigned) * 10_000) / 100
}

function ageString(creationTimestamp: string): string {
  if (!creationTimestamp) return 'unknown'
  const ms = Date.now() - new Date(creationTimestamp).getTime()
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

export class KubernetesMonitor extends EventEmitter {
  private timers = new Map<string, ReturnType<typeof setInterval>>()
  private podNetworkPrevious = new Map<string, { rx: number; tx: number; timestamp: number }>()

  start(serverId: string, intervalSeconds: number, initialDelayMs = 0): void {
    this.stop(serverId)
    const poll = (): void => { this.poll(serverId).catch(() => {}) }
    const startPolling = (): void => {
      poll()
      this.timers.set(serverId, setInterval(poll, intervalSeconds * 1000))
    }
    if (initialDelayMs > 0) {
      setTimeout(startPolling, initialDelayMs)
    } else {
      startPolling()
    }
  }

  stop(serverId: string): void {
    const timer = this.timers.get(serverId)
    if (timer) { clearInterval(timer); this.timers.delete(serverId) }
    for (const key of this.podNetworkPrevious.keys()) {
      if (key.startsWith(`${serverId}/`)) this.podNetworkPrevious.delete(key)
    }
  }

  stopAll(): void { for (const id of this.timers.keys()) this.stop(id) }

  private async poll(serverId: string): Promise<void> {
    try {
      const checkRes = await sshManager.execCommand(serverId, COMMANDS.kubernetes.check)
      const checkOut = checkRes.stdout.trim()
      if (checkRes.code !== 0 || !checkOut) {
        this.emit('data', { serverId, available: false, pods: [], services: [], deployments: [], events: [] })
        return
      }

      const [podsRes, servicesRes, deploymentsRes, eventsRes, metricsRes, networkStatsRes] = await Promise.all([
        sshManager.execCommand(serverId, COMMANDS.kubernetes.pods),
        sshManager.execCommand(serverId, COMMANDS.kubernetes.services),
        sshManager.execCommand(serverId, COMMANDS.kubernetes.deployments),
        sshManager.execCommand(serverId, COMMANDS.kubernetes.events),
        sshManager.execCommand(serverId, COMMANDS.kubernetes.podMetrics),
        sshManager.execCommand(serverId, COMMANDS.kubernetes.podNetworkStats)
      ])

      const pods = this.parsePods(serverId, podsRes.stdout, metricsRes.stdout, networkStatsRes.stdout)
      const services = this.parseServices(servicesRes.stdout)
      const deployments = this.parseDeployments(deploymentsRes.stdout)
      const events = this.parseEvents(eventsRes.stdout)

      this.emit('data', { serverId, available: true, pods, services, deployments, events })
    } catch (err) {
      const msg = (err as Error)?.message ?? ''
      // Transient SSH errors: silently retry, don't change UI state
      if (
        msg.includes('not connected') ||
        msg.includes('ECONNREFUSED') ||
        msg.includes('ETIMEDOUT') ||
        msg.includes('Connection lost') ||
        msg.includes('socket hang up') ||
        msg.includes('read ECONNRESET') ||
        msg.includes('Channel open failure') ||
        msg.includes('channel open') ||
        msg.includes('resource shortage') ||
        msg.includes('CHANNEL_OPEN_FAILURE')
      ) return
      console.error(`[kubernetes-monitor] poll error for ${serverId}:`, msg)
      this.emit('data', { serverId, available: false, pods: [], services: [], deployments: [], events: [] })
    }
  }

  private parsePodMetrics(output: string): Map<string, { cpu: number; memory: number }> {
    const result = new Map<string, { cpu: number; memory: number }>()
    try {
      const data = JSON.parse(output) as { items?: PodMetricsItem[] }
      for (const pod of data.items || []) {
        const key = `${pod.metadata?.namespace || 'default'}/${pod.metadata?.name || ''}`
        const usage = (pod.containers || []).reduce(
          (total, container) => ({
            cpu: total.cpu + parseCpuMillicores(container.usage?.cpu),
            memory: total.memory + parseMemoryBytes(container.usage?.memory)
          }),
          { cpu: 0, memory: 0 }
        )
        result.set(key, usage)
      }
    } catch {
      // metrics-server may not be installed or ready yet
    }
    return result
  }

  private parsePodNetwork(output: string): Map<string, PodNetworkTotal> {
    const result = new Map<string, PodNetworkTotal>()
    const chunks = output.split(/^__MONITC_NODE__.*$/m).map((chunk) => chunk.trim()).filter(Boolean)
    for (const chunk of chunks) {
      try {
        const summary = JSON.parse(chunk) as PodStatsSummary
        for (const pod of summary.pods || []) {
          const key = `${pod.podRef?.namespace || 'default'}/${pod.podRef?.name || ''}`
          result.set(key, {
            rx: pod.network?.rxBytes || 0,
            tx: pod.network?.txBytes || 0
          })
        }
      } catch {
        // Some Kubernetes distributions restrict kubelet summary access.
      }
    }
    return result
  }

  private parsePods(serverId: string, output: string, metricsOutput: string, networkOutput: string): K8sPod[] {
    try {
      const data = JSON.parse(output)
      const usageByPod = this.parsePodMetrics(metricsOutput)
      const networkByPod = this.parsePodNetwork(networkOutput)
      const sampledAt = Date.now()
      const activeNetworkKeys = new Set<string>()
      const pods = (data.items || []).map((item: Record<string, unknown>) => {
        const meta = item.metadata as Record<string, unknown>
        const spec = item.spec as Record<string, unknown>
        const status = item.status as Record<string, unknown>
        const containerStatuses = (status.containerStatuses as Record<string, unknown>[]) || []
        const restarts = containerStatuses.reduce((sum: number, cs: Record<string, unknown>) => sum + ((cs.restartCount as number) || 0), 0)
        const readyCount = containerStatuses.filter((cs: Record<string, unknown>) => cs.ready).length
        const containerSpecs = (spec.containers as Record<string, unknown>[]) || []
        const containers = containerSpecs.map((c: Record<string, unknown>) => c.name as string)
        const podKey = `${meta.namespace as string}/${meta.name as string}`
        const usage = usageByPod.get(podKey) || { cpu: 0, memory: 0 }
        const resources = containerSpecs.reduce<PodResourceTotals>(
          (total, container) => {
            const containerResources = (container.resources as Record<string, unknown>) || {}
            const requests = (containerResources.requests as Record<string, string>) || {}
            const limits = (containerResources.limits as Record<string, string>) || {}
            total.cpuRequest += parseCpuMillicores(requests.cpu)
            total.cpuLimit += parseCpuMillicores(limits.cpu)
            total.memoryRequest += parseMemoryBytes(requests.memory)
            total.memoryLimit += parseMemoryBytes(limits.memory)
            return total
          },
          { cpuRequest: 0, cpuLimit: 0, memoryRequest: 0, memoryLimit: 0 }
        )
        const previousKey = `${serverId}/${podKey}`
        activeNetworkKeys.add(previousKey)
        const network = networkByPod.get(podKey)
        const previous = this.podNetworkPrevious.get(previousKey)
        const elapsedSeconds = previous ? Math.max(1, (sampledAt - previous.timestamp) / 1000) : 0
        const rxRate = network && previous && network.rx >= previous.rx
          ? (network.rx - previous.rx) / elapsedSeconds
          : 0
        const txRate = network && previous && network.tx >= previous.tx
          ? (network.tx - previous.tx) / elapsedSeconds
          : 0
        if (network) this.podNetworkPrevious.set(previousKey, { ...network, timestamp: sampledAt })
        return {
          namespace: meta.namespace as string,
          name: meta.name as string,
          status: (status.phase as string) || 'Unknown',
          ready: `${readyCount}/${containers.length}`,
          restarts,
          age: ageString(meta.creationTimestamp as string),
          node: (spec.nodeName as string) || '',
          ip: (status.podIP as string) || '',
          containers,
          cpuUsageMillicores: usage.cpu,
          cpuRequestMillicores: resources.cpuRequest,
          cpuLimitMillicores: resources.cpuLimit,
          cpuUsagePercent: usagePercent(usage.cpu, resources.cpuLimit || resources.cpuRequest),
          memoryUsageBytes: usage.memory,
          memoryRequestBytes: resources.memoryRequest,
          memoryLimitBytes: resources.memoryLimit,
          memoryUsagePercent: usagePercent(usage.memory, resources.memoryLimit || resources.memoryRequest),
          networkRxBytesPerSecond: rxRate,
          networkTxBytesPerSecond: txRate
        }
      })
      for (const key of this.podNetworkPrevious.keys()) {
        if (key.startsWith(`${serverId}/`) && !activeNetworkKeys.has(key)) {
          this.podNetworkPrevious.delete(key)
        }
      }
      return pods
    } catch { return [] }
  }

  private parseServices(output: string): K8sService[] {
    try {
      const data = JSON.parse(output)
      return (data.items || []).map((item: Record<string, unknown>) => {
        const meta = item.metadata as Record<string, unknown>
        const spec = item.spec as Record<string, unknown>
        const status = item.status as Record<string, unknown>
        const lbIngress = ((status.loadBalancer as Record<string, unknown>)?.ingress as Record<string, string>[]) || []
        const externalIP = lbIngress.length > 0 ? (lbIngress[0].ip || lbIngress[0].hostname || '') : ((spec.externalIPs as string[]) || []).join(',') || ''
        const ports = ((spec.ports as Record<string, unknown>[]) || []).map((p: Record<string, unknown>) => `${p.port}/${p.protocol}`).join(', ')
        return {
          namespace: meta.namespace as string,
          name: meta.name as string,
          type: spec.type as string,
          clusterIP: spec.clusterIP as string,
          externalIP,
          ports,
          age: ageString(meta.creationTimestamp as string)
        }
      })
    } catch { return [] }
  }

  private parseDeployments(output: string): K8sDeployment[] {
    try {
      const data = JSON.parse(output)
      return (data.items || []).map((item: Record<string, unknown>) => {
        const meta = item.metadata as Record<string, unknown>
        const spec = item.spec as Record<string, unknown>
        const status = item.status as Record<string, unknown>
        const replicas = (spec.replicas as number) || 0
        const readyReplicas = (status.readyReplicas as number) || 0
        return {
          namespace: meta.namespace as string,
          name: meta.name as string,
          ready: `${readyReplicas}/${replicas}`,
          upToDate: (status.updatedReplicas as number) || 0,
          available: (status.availableReplicas as number) || 0,
          age: ageString(meta.creationTimestamp as string)
        }
      })
    } catch { return [] }
  }

  private parseEvents(output: string): K8sEvent[] {
    try {
      const data = JSON.parse(output)
      return (data.items || [])
        .slice(-50)
        .map((item: Record<string, unknown>) => {
          const meta = item.metadata as Record<string, unknown>
          const involvedObject = item.involvedObject as Record<string, unknown>
          return {
            namespace: (involvedObject.namespace as string) || (meta.namespace as string),
            name: (involvedObject.name as string) || '',
            reason: (item.reason as string) || '',
            message: (item.message as string) || '',
            type: (item.type as string) || 'Normal',
            count: (item.count as number) || 1,
            lastTimestamp: (item.lastTimestamp as string) || ''
          }
        })
    } catch { return [] }
  }
}

export const kubernetesMonitor = new KubernetesMonitor()
