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

  start(serverId: string, intervalSeconds: number): void {
    this.stop(serverId)
    const poll = (): void => { this.poll(serverId).catch(() => {}) }
    poll()
    this.timers.set(serverId, setInterval(poll, intervalSeconds * 1000))
  }

  stop(serverId: string): void {
    const timer = this.timers.get(serverId)
    if (timer) { clearInterval(timer); this.timers.delete(serverId) }
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

      const [podsRes, servicesRes, deploymentsRes, eventsRes] = await Promise.all([
        sshManager.execCommand(serverId, COMMANDS.kubernetes.pods),
        sshManager.execCommand(serverId, COMMANDS.kubernetes.services),
        sshManager.execCommand(serverId, COMMANDS.kubernetes.deployments),
        sshManager.execCommand(serverId, COMMANDS.kubernetes.events)
      ])

      const pods = this.parsePods(podsRes.stdout)
      const services = this.parseServices(servicesRes.stdout)
      const deployments = this.parseDeployments(deploymentsRes.stdout)
      const events = this.parseEvents(eventsRes.stdout)

      this.emit('data', { serverId, available: true, pods, services, deployments, events })
    } catch {
      // emit nothing
    }
  }

  private parsePods(output: string): K8sPod[] {
    try {
      const data = JSON.parse(output)
      return (data.items || []).map((item: Record<string, unknown>) => {
        const meta = item.metadata as Record<string, unknown>
        const spec = item.spec as Record<string, unknown>
        const status = item.status as Record<string, unknown>
        const containerStatuses = (status.containerStatuses as Record<string, unknown>[]) || []
        const restarts = containerStatuses.reduce((sum: number, cs: Record<string, unknown>) => sum + ((cs.restartCount as number) || 0), 0)
        const readyCount = containerStatuses.filter((cs: Record<string, unknown>) => cs.ready).length
        const containers = ((spec.containers as Record<string, unknown>[]) || []).map((c: Record<string, unknown>) => c.name as string)
        return {
          namespace: meta.namespace as string,
          name: meta.name as string,
          status: (status.phase as string) || 'Unknown',
          ready: `${readyCount}/${containers.length}`,
          restarts,
          age: ageString(meta.creationTimestamp as string),
          node: (spec.nodeName as string) || '',
          ip: (status.podIP as string) || '',
          containers
        }
      })
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
