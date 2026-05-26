import { EventEmitter } from 'events'
import { sshManager } from '../ssh/ssh-manager'
import { COMMANDS } from '../ssh/ssh-commands'
import type { DockerContainer, DockerImage, DockerNetwork, DockerVolume } from '../store/types'

export interface DockerData {
  serverId: string
  available: boolean
  containers: DockerContainer[]
  images: DockerImage[]
  networks: DockerNetwork[]
  volumes: DockerVolume[]
}

function parseJsonLines<T>(output: string): T[] {
  return output
    .trim()
    .split('\n')
    .filter((l) => l.trim().startsWith('{'))
    .map((l) => { try { return JSON.parse(l) as T } catch { return null } })
    .filter(Boolean) as T[]
}

export class DockerMonitor extends EventEmitter {
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
      const checkRes = await sshManager.execCommand(serverId, COMMANDS.docker.check)
      if (checkRes.code !== 0 || !checkRes.stdout.trim()) {
        this.emit('data', { serverId, available: false, containers: [], images: [], networks: [], volumes: [] })
        return
      }

      const [containersRes, imagesRes, statsRes, networksRes, volumesRes] = await Promise.all([
        sshManager.execCommand(serverId, COMMANDS.docker.containers),
        sshManager.execCommand(serverId, COMMANDS.docker.images),
        sshManager.execCommand(serverId, COMMANDS.docker.stats),
        sshManager.execCommand(serverId, COMMANDS.docker.networks),
        sshManager.execCommand(serverId, COMMANDS.docker.volumes)
      ])

      const rawStats = parseJsonLines<Record<string, string>>(statsRes.stdout)
      const statsMap = new Map(rawStats.map((s) => [s.ID || s.id, s]))

      const containers: DockerContainer[] = parseJsonLines<Record<string, string>>(containersRes.stdout).map((c) => {
        const id = c.ID || c.id || ''
        const stats = statsMap.get(id) || statsMap.get(id.slice(0, 12)) || {}
        return {
          id,
          names: c.Names || c.names || '',
          image: c.Image || c.image || '',
          command: c.Command || c.command || '',
          created: c.CreatedAt || c.created || '',
          status: c.Status || c.status || '',
          ports: c.Ports || c.ports || '',
          state: c.State || c.state || '',
          cpuPercent: parseFloat(String(stats.CPUPerc || '0').replace('%', '')) || 0,
          memPercent: parseFloat(String(stats.MemPerc || '0').replace('%', '')) || 0,
          memUsage: stats.MemUsage || ''
        }
      })

      const images: DockerImage[] = parseJsonLines<Record<string, string>>(imagesRes.stdout).map((i) => ({
        id: i.ID || i.id || '',
        repository: i.Repository || i.repository || '',
        tag: i.Tag || i.tag || '',
        size: i.Size || i.size || '',
        created: i.CreatedAt || i.created || ''
      }))

      const networks: DockerNetwork[] = parseJsonLines<Record<string, string>>(networksRes.stdout).map((n) => ({
        id: n.ID || n.id || '',
        name: n.Name || n.name || '',
        driver: n.Driver || n.driver || '',
        scope: n.Scope || n.scope || ''
      }))

      const volumes: DockerVolume[] = parseJsonLines<Record<string, string>>(volumesRes.stdout).map((v) => ({
        name: v.Name || v.name || '',
        driver: v.Driver || v.driver || '',
        mountpoint: v.Mountpoint || v.mountpoint || '',
        scope: v.Scope || v.scope || ''
      }))

      this.emit('data', { serverId, available: true, containers, images, networks, volumes })
    } catch (err) {
      const msg = (err as Error)?.message ?? ''
      if (
        msg.includes('not connected') ||
        msg.includes('ECONNREFUSED') ||
        msg.includes('ETIMEDOUT') ||
        msg.includes('Connection lost') ||
        msg.includes('socket hang up') ||
        msg.includes('read ECONNRESET')
      ) return
      console.error(`[docker-monitor] poll error for ${serverId}:`, msg)
      this.emit('data', { serverId, available: false, containers: [], images: [], networks: [], volumes: [] })
    }
  }
}

export const dockerMonitor = new DockerMonitor()
