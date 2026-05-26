import { EventEmitter } from 'events'
import { sshManager } from '../ssh/ssh-manager'
import { COMMANDS } from '../ssh/ssh-commands'
import { metricsDb } from './metrics-db'
import type { SystemMetrics, DiskPartition, NetworkInterface } from '../store/types'

// Purge old metrics once per hour
const PURGE_INTERVAL_MS = 60 * 60 * 1000

export class SystemMonitor extends EventEmitter {
  private timers = new Map<string, ReturnType<typeof setInterval>>()
  private prevNetworkStats = new Map<string, Record<string, { rx: number; tx: number }>>()
  private purgeTimer: ReturnType<typeof setInterval> | null = null

  start(serverId: string, intervalSeconds: number): void {
    this.stop(serverId)
    const poll = (): void => { this.poll(serverId).catch(() => {}) }
    poll()
    this.timers.set(serverId, setInterval(poll, intervalSeconds * 1000))

    if (!this.purgeTimer) {
      this.purgeTimer = setInterval(() => metricsDb.purgeOld(), PURGE_INTERVAL_MS)
    }
  }

  stop(serverId: string): void {
    const timer = this.timers.get(serverId)
    if (timer) {
      clearInterval(timer)
      this.timers.delete(serverId)
    }
  }

  stopAll(): void {
    for (const id of this.timers.keys()) this.stop(id)
    if (this.purgeTimer) {
      clearInterval(this.purgeTimer)
      this.purgeTimer = null
    }
    metricsDb.close()
  }

  private async poll(serverId: string): Promise<void> {
    try {
      const [cpuRes, memRes, diskRes, netRes, uptimeRes, loadRes] = await Promise.all([
        sshManager.execCommand(serverId, COMMANDS.system.cpu),
        sshManager.execCommand(serverId, COMMANDS.system.memory),
        sshManager.execCommand(serverId, COMMANDS.system.disk),
        sshManager.execCommand(serverId, COMMANDS.system.network),
        sshManager.execCommand(serverId, COMMANDS.system.uptime),
        sshManager.execCommand(serverId, COMMANDS.system.loadAvg)
      ])

      const cpu = this.parseCpu(cpuRes.stdout)
      const memory = this.parseMemory(memRes.stdout)
      const disk = this.parseDisk(diskRes.stdout)
      const network = this.parseNetwork(serverId, netRes.stdout)
      const loadAvg = this.parseLoadAvg(loadRes.stdout)

      const metrics: SystemMetrics = {
        serverId,
        timestamp: Date.now(),
        cpu: { percent: cpu, loadAvg },
        memory,
        disk,
        network,
        uptime: uptimeRes.stdout.trim()
      }
      this.emit('metrics', metrics)
      metricsDb.insert(metrics)
    } catch {
      // Connection might be down; emit nothing
    }
  }

  private parseCpu(output: string): number {
    const val = parseFloat(output.trim())
    return isNaN(val) ? 0 : Math.min(100, val)
  }

  private parseMemory(output: string): SystemMetrics['memory'] {
    const parts = output.trim().split(/\s+/)
    const total = parseInt(parts[0]) || 0
    const used = parseInt(parts[1]) || 0
    const free = parseInt(parts[2]) || 0
    const percent = total > 0 ? Math.round((used / total) * 100) : 0
    return { total, used, free, percent }
  }

  private parseDisk(output: string): DiskPartition[] {
    return output
      .trim()
      .split('\n')
      .filter((l) => l.trim())
      .map((line) => {
        const parts = line.trim().split(/\s+/)
        if (parts.length >= 6) {
          return {
            source: parts[0],
            total: parseInt(parts[1]) || 0,
            used: parseInt(parts[2]) || 0,
            available: parseInt(parts[3]) || 0,
            percent: parseInt(parts[4]) || 0,
            mountpoint: parts[5]
          }
        }
        return null
      })
      .filter(Boolean) as DiskPartition[]
  }

  private parseNetwork(serverId: string, output: string): NetworkInterface[] {
    const lines = output.trim().split('\n').filter((l) => l.trim())
    const now: Record<string, { rx: number; tx: number }> = {}
    const prev = this.prevNetworkStats.get(serverId) || {}

    const interfaces: NetworkInterface[] = []
    for (const line of lines) {
      const match = line.match(/^\s*(\S+):\s*(\d+)\s+(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)\s+(\d+)/)
      if (!match) continue
      const name = match[1]
      const rxBytes = parseInt(match[2])
      const rxPackets = parseInt(match[3])
      const txBytes = parseInt(match[4])
      const txPackets = parseInt(match[5])
      now[name] = { rx: rxBytes, tx: txBytes }
      const prevEntry = prev[name]
      interfaces.push({
        name,
        rxBytes: prevEntry ? Math.max(0, rxBytes - prevEntry.rx) : 0,
        txBytes: prevEntry ? Math.max(0, txBytes - prevEntry.tx) : 0,
        rxPackets,
        txPackets
      })
    }
    this.prevNetworkStats.set(serverId, now)
    return interfaces.filter((i) => i.name !== 'lo')
  }

  private parseLoadAvg(output: string): [number, number, number] {
    const parts = output.trim().split(/\s+/)
    return [parseFloat(parts[0]) || 0, parseFloat(parts[1]) || 0, parseFloat(parts[2]) || 0]
  }
}

export const systemMonitor = new SystemMonitor()
