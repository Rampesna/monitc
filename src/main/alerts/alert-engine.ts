import { EventEmitter } from 'events'
import type { AlertRule, SystemMetrics, AppData, SmtpConfig, WhatsAppConfig, TelegramConfig, ConnectionStatus } from '../store/types'
import { sshManager } from '../ssh/ssh-manager'
import { sendSmtpAlert } from './channels/smtp-channel'
import { sendWhatsAppAlert } from './channels/whatsapp-channel'
import { sendTelegramAlert } from './channels/telegram-channel'

export interface TriggeredAlert {
  ruleId: string
  ruleName: string
  serverId: string
  metric: string
  value: number
  threshold: number
  timestamp: number
  message: string
}

const CONNECTION_LOST_METRIC = 'connection_lost'

export class AlertEngine extends EventEmitter {
  private getData: (() => AppData) | null = null
  private setData: ((data: AppData) => void) | null = null
  private connectionTimers = new Map<string, ReturnType<typeof setTimeout>>()

  initialize(getData: () => AppData, setData: (data: AppData) => void): void {
    this.getData = getData
    this.setData = setData
  }

  clearConnectionAlertsForServer(serverId: string): void {
    if (!this.getData) return
    const data = this.getData()
    for (const rule of data.alertRules) {
      if (rule.serverId === serverId && rule.metric === CONNECTION_LOST_METRIC) {
        this.clearConnectionTimer(rule.id)
      }
    }
  }

  async evaluate(metrics: SystemMetrics): Promise<void> {
    if (!this.getData || !this.setData) return
    const data = this.getData()
    const rules = data.alertRules.filter(
      (r) => r.enabled && r.serverId === metrics.serverId && r.metric !== CONNECTION_LOST_METRIC
    )
    if (rules.length === 0) return

    const now = Date.now()
    let changed = false

    for (const rule of rules) {
      const value = this.extractMetricValue(metrics, rule.metric)
      if (value === null) continue

      const breached = this.checkOperator(value, rule.operator, rule.threshold)

      if (breached) {
        rule.consecutiveBreaches++
      } else {
        rule.consecutiveBreaches = 0
        changed = true
        continue
      }
      changed = true

      const requiredBreaches = Math.ceil(rule.durationSeconds / 5)
      if (rule.consecutiveBreaches < requiredBreaches) continue

      if (rule.lastTriggeredAt && now - rule.lastTriggeredAt < rule.cooldownMinutes * 60 * 1000) continue

      rule.lastTriggeredAt = now
      const message = this.buildMetricMessage(rule, value, metrics)
      const alert: TriggeredAlert = {
        ruleId: rule.id,
        ruleName: rule.name,
        serverId: rule.serverId,
        metric: rule.metric,
        value,
        threshold: rule.threshold,
        timestamp: now,
        message
      }

      this.emit('alert', alert)
      await this.dispatch(rule, message, data)
    }

    if (changed) {
      this.persistRules(data, rules)
    }
  }

  async evaluateConnectionStatus(status: ConnectionStatus): Promise<void> {
    if (!this.getData || !this.setData) return

    if (status.status === 'connected') {
      this.resetConnectionRules(status.serverId)
      return
    }

    if (status.status !== 'disconnected' && status.status !== 'error') return

    const data = this.getData()
    const rules = data.alertRules.filter(
      (r) => r.enabled && r.serverId === status.serverId && r.metric === CONNECTION_LOST_METRIC
    )
    if (rules.length === 0) return

    for (const rule of rules) {
      if (this.connectionTimers.has(rule.id)) continue

      const timer = setTimeout(() => {
        this.connectionTimers.delete(rule.id)
        this.fireConnectionAlertIfStillDown(rule.id, status).catch(console.error)
      }, rule.durationSeconds * 1000)

      this.connectionTimers.set(rule.id, timer)
    }
  }

  private async fireConnectionAlertIfStillDown(ruleId: string, status: ConnectionStatus): Promise<void> {
    if (!this.getData || !this.setData) return

    const currentStatus = sshManager.getStatus(status.serverId)
    if (currentStatus === 'connected' || currentStatus === 'connecting') return

    const data = this.getData()
    const rule = data.alertRules.find((r) => r.id === ruleId)
    if (!rule || !rule.enabled || rule.metric !== CONNECTION_LOST_METRIC) return

    const now = Date.now()
    if (rule.lastTriggeredAt && now - rule.lastTriggeredAt < rule.cooldownMinutes * 60 * 1000) return

    rule.lastTriggeredAt = now
    rule.consecutiveBreaches = 1

    const server = data.servers.find((s) => s.id === status.serverId)
    const serverLabel = server ? `${server.name} (${server.host})` : status.serverId
    const reason = status.error ?? (currentStatus === 'error' ? 'SSH bağlantı hatası' : 'SSH bağlantısı kesildi')
    const message = this.buildConnectionMessage(rule, serverLabel, reason, currentStatus)

    const alert: TriggeredAlert = {
      ruleId: rule.id,
      ruleName: rule.name,
      serverId: rule.serverId,
      metric: rule.metric,
      value: 1,
      threshold: 0,
      timestamp: now,
      message
    }

    this.emit('alert', alert)
    await this.dispatch(rule, message, data)
    this.persistRules(data, [rule])
  }

  private resetConnectionRules(serverId: string): void {
    if (!this.getData || !this.setData) return

    const data = this.getData()
    const rules = data.alertRules.filter(
      (r) => r.serverId === serverId && r.metric === CONNECTION_LOST_METRIC
    )
    if (rules.length === 0) return

    let changed = false
    for (const rule of rules) {
      this.clearConnectionTimer(rule.id)
      if (rule.consecutiveBreaches !== 0) {
        rule.consecutiveBreaches = 0
        changed = true
      }
    }

    if (changed) {
      this.persistRules(data, rules)
    }
  }

  private clearConnectionTimer(ruleId: string): void {
    const timer = this.connectionTimers.get(ruleId)
    if (timer) {
      clearTimeout(timer)
      this.connectionTimers.delete(ruleId)
    }
  }

  private persistRules(data: AppData, updatedRules: AlertRule[]): void {
    if (!this.setData) return
    this.setData({
      ...data,
      alertRules: data.alertRules.map((r) => updatedRules.find((u) => u.id === r.id) ?? r)
    })
  }

  private extractMetricValue(metrics: SystemMetrics, metricType: string): number | null {
    switch (metricType) {
      case 'cpu_percent': return metrics.cpu.percent
      case 'memory_percent': return metrics.memory.percent
      case 'disk_percent': {
        const primaryDisk = metrics.disk.find((d) => d.mountpoint === '/') || metrics.disk[0]
        return primaryDisk ? primaryDisk.percent : null
      }
      case 'network_rx_bytes': return metrics.network.reduce((s, n) => s + n.rxBytes, 0)
      case 'network_tx_bytes': return metrics.network.reduce((s, n) => s + n.txBytes, 0)
      default: return null
    }
  }

  private checkOperator(value: number, operator: 'gt' | 'lt' | 'eq', threshold: number): boolean {
    if (operator === 'gt') return value > threshold
    if (operator === 'lt') return value < threshold
    return value === threshold
  }

  private buildMetricMessage(rule: AlertRule, value: number, metrics: SystemMetrics): string {
    const opStr = rule.operator === 'gt' ? 'aştı' : rule.operator === 'lt' ? 'altına düştü' : 'eşit oldu'
    return `[monitc ALARM] ${rule.name}\nSunucu: ${metrics.serverId}\nMetrik: ${rule.metric}\nDeğer: ${value.toFixed(2)} (Eşik: ${rule.threshold} ${opStr})\nZaman: ${new Date().toLocaleString('tr-TR')}`
  }

  private buildConnectionMessage(rule: AlertRule, serverLabel: string, reason: string, status: string): string {
    return `[monitc ALARM] ${rule.name}\nSunucu: ${serverLabel}\nDurum: Sunucuya SSH ile erişilemiyor\nSebep: ${reason}\nBağlantı: ${status}\nZaman: ${new Date().toLocaleString('tr-TR')}`
  }

  private async dispatch(rule: AlertRule, message: string, data: AppData): Promise<void> {
    const promises: Promise<void>[] = []
    const subject = `[monitc] Alarm: ${rule.name}`

    if (rule.channels.includes('smtp') && data.integrations.smtp?.enabled) {
      const smtp = data.integrations.smtp as SmtpConfig
      promises.push(sendSmtpAlert(smtp, subject, message, rule.recipients).catch(console.error))
    }
    if (rule.channels.includes('whatsapp') && data.integrations.whatsapp?.enabled) {
      const wa = data.integrations.whatsapp as WhatsAppConfig
      promises.push(sendWhatsAppAlert(wa, message, rule.recipients).catch(console.error))
    }
    if (rule.channels.includes('telegram') && data.integrations.telegram?.enabled) {
      const tg = data.integrations.telegram as TelegramConfig
      promises.push(sendTelegramAlert(tg, `<b>${subject}</b>\n<code>${message}</code>`).catch(console.error))
    }

    await Promise.all(promises)
  }
}

export const alertEngine = new AlertEngine()
