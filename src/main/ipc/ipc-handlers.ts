import { ipcMain, BrowserWindow } from 'electron'
import { sshManager } from '../ssh/ssh-manager'
import { systemMonitor } from '../monitors/system-monitor'
import { dockerMonitor } from '../monitors/docker-monitor'
import { kubernetesMonitor } from '../monitors/kubernetes-monitor'
import { logStreamer } from '../monitors/log-streamer'
import { sshTerminalManager } from '../ssh/ssh-terminal-manager'
import { alertEngine } from '../alerts/alert-engine'
import { loadData, saveData, resetData } from '../store/store'
import { metricsDb } from '../monitors/metrics-db'
import { testSmtp } from '../alerts/channels/smtp-channel'
import { testWhatsApp } from '../alerts/channels/whatsapp-channel'
import { testTelegram } from '../alerts/channels/telegram-channel'
import type { AppData, Server, ConnectionStatus } from '../store/types'
import { app } from 'electron'
import { COMMANDS } from '../ssh/ssh-commands'
import crypto from 'crypto'

let appData: AppData

function getWin(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] ?? null
}

function send(channel: string, data: unknown): void {
  getWin()?.webContents.send(channel, data)
}

function startMonitors(serverId: string): void {
  const { pollIntervals } = appData.preferences
  systemMonitor.start(serverId, pollIntervals.system)
  // Stagger docker and kubernetes starts to avoid a concurrent SSH channel burst
  setTimeout(() => dockerMonitor.start(serverId, pollIntervals.docker), 3000)
  kubernetesMonitor.start(serverId, pollIntervals.kubernetes, 6000)
}

export function setupIpcHandlers(): void {
  appData = loadData()

  alertEngine.initialize(
    () => appData,
    (data) => { appData = data; saveData(appData) }
  )

  sshManager.on('status', (status: ConnectionStatus) => {
    send('connection:status', status)
    alertEngine.evaluateConnectionStatus(status).catch(console.error)
    if (status.status === 'connected' && appData.servers.some((s) => s.id === status.serverId)) {
      startMonitors(status.serverId)
    }
  })

  systemMonitor.on('metrics', (metrics) => {
    send('metrics:update', metrics)
    alertEngine.evaluate(metrics).catch(console.error)
  })

  dockerMonitor.on('data', (data) => send('docker:update', data))
  kubernetesMonitor.on('data', (data) => send('kubernetes:update', data))

  logStreamer.on('data', ({ streamId, data }) => send(`log:data:${streamId}`, data))
  logStreamer.on('close', ({ streamId }) => send(`log:close:${streamId}`, null))
  logStreamer.on('error', ({ streamId, error }) => send(`log:error:${streamId}`, error))

  alertEngine.on('alert', (alert) => send('alert:triggered', alert))

  sshTerminalManager.on('data', ({ sessionId, data }) => send(`terminal:data:${sessionId}`, data))
  sshTerminalManager.on('close', ({ sessionId }) => send(`terminal:close:${sessionId}`, null))

  ipcMain.handle('terminal:open', async (_, serverId: string, cols: number, rows: number) => {
    const server = appData.servers.find((s) => s.id === serverId)
    if (!server) return { success: false, error: 'Server not found' }
    try {
      const sessionId = await sshTerminalManager.open(server, cols, rows)
      return { success: true, sessionId }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.on('terminal:write', (_, sessionId: string, data: string) => {
    sshTerminalManager.write(sessionId, data)
  })

  ipcMain.on('terminal:resize', (_, sessionId: string, cols: number, rows: number) => {
    sshTerminalManager.resize(sessionId, cols, rows)
  })

  ipcMain.handle('terminal:close', async (_, sessionId: string) => {
    sshTerminalManager.close(sessionId)
    return true
  })

  ipcMain.handle('servers:list', () => appData.servers)

  ipcMain.handle('servers:add', async (_, server: Omit<Server, 'id'>) => {
    const newServer: Server = { ...server, id: crypto.randomUUID() }
    appData.servers.push(newServer)
    saveData(appData)
    return newServer
  })

  ipcMain.handle('servers:update', async (_, server: Server) => {
    const idx = appData.servers.findIndex((s) => s.id === server.id)
    if (idx !== -1) { appData.servers[idx] = server; saveData(appData) }
    return server
  })

  ipcMain.handle('servers:remove', async (_, serverId: string) => {
    alertEngine.clearConnectionAlertsForServer(serverId)
    sshManager.disconnect(serverId)
    systemMonitor.stop(serverId)
    dockerMonitor.stop(serverId)
    kubernetesMonitor.stop(serverId)
    logStreamer.stopAllForServer(serverId)
    sshTerminalManager.closeAllForServer(serverId)
    appData.servers = appData.servers.filter((s) => s.id !== serverId)
    saveData(appData)
    return true
  })

  ipcMain.handle('servers:test', async (_, server: Server) => {
    return sshManager.testConnection(server)
  })

  ipcMain.handle('monitor:start', async (_, serverId: string) => {
    const server = appData.servers.find((s) => s.id === serverId)
    if (!server) return { success: false, error: 'Server not found' }
    try {
      const wasConnected = sshManager.getStatus(serverId) === 'connected'
      await sshManager.connect(server)
      if (wasConnected) startMonitors(serverId)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('monitor:stop', async (_, serverId: string) => {
    systemMonitor.stop(serverId)
    dockerMonitor.stop(serverId)
    kubernetesMonitor.stop(serverId)
    sshManager.disconnect(serverId)
    return true
  })

  ipcMain.handle('monitor:status', async (_, serverId: string) => {
    return sshManager.getStatus(serverId)
  })

  ipcMain.handle('docker:action', async (_, serverId: string, action: string, containerId: string) => {
    const cmdMap: Record<string, (id: string) => string> = {
      start: COMMANDS.docker.start,
      stop: COMMANDS.docker.stop,
      restart: COMMANDS.docker.restart,
      remove: COMMANDS.docker.remove
    }
    const cmd = cmdMap[action]
    if (!cmd) return { success: false, error: 'Unknown action' }
    try {
      const res = await sshManager.execCommand(serverId, cmd(containerId))
      return { success: res.code === 0, stdout: res.stdout, error: res.stderr }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('docker:inspect', async (_, serverId: string, containerId: string) => {
    try {
      const res = await sshManager.execCommand(serverId, COMMANDS.docker.inspect(containerId))
      return JSON.parse(res.stdout)
    } catch { return null }
  })

  ipcMain.handle('logs:start:docker', (_, serverId: string, containerId: string, tail: number) => {
    return logStreamer.startDockerLog(serverId, containerId, tail)
  })

  ipcMain.handle('logs:start:k8s', (_, serverId: string, namespace: string, pod: string, container?: string) => {
    return logStreamer.startKubernetesLog(serverId, namespace, pod, container)
  })

  ipcMain.handle('logs:stop', (_, streamId: string) => {
    logStreamer.stopStream(streamId)
    return true
  })

  ipcMain.handle('alerts:list', () => appData.alertRules)

  ipcMain.handle('alerts:add', async (_, rule: Omit<import('../store/types').AlertRule, 'id' | 'lastTriggeredAt' | 'consecutiveBreaches'>) => {
    const newRule = { ...rule, id: crypto.randomUUID(), lastTriggeredAt: null, consecutiveBreaches: 0 }
    appData.alertRules.push(newRule)
    saveData(appData)
    return newRule
  })

  ipcMain.handle('alerts:update', async (_, rule: import('../store/types').AlertRule) => {
    const idx = appData.alertRules.findIndex((r) => r.id === rule.id)
    if (idx !== -1) { appData.alertRules[idx] = rule; saveData(appData) }
    return rule
  })

  ipcMain.handle('alerts:remove', async (_, ruleId: string) => {
    appData.alertRules = appData.alertRules.filter((r) => r.id !== ruleId)
    saveData(appData)
    return true
  })

  ipcMain.handle('settings:get', () => appData.integrations)

  ipcMain.handle('settings:save', async (_, integrations: AppData['integrations']) => {
    appData.integrations = integrations
    saveData(appData)
    return true
  })

  ipcMain.handle('settings:test:smtp', async (_, config: import('../store/types').SmtpConfig) => testSmtp(config))
  ipcMain.handle('settings:test:whatsapp', async (_, config: import('../store/types').WhatsAppConfig) => testWhatsApp(config))
  ipcMain.handle('settings:test:telegram', async (_, config: import('../store/types').TelegramConfig) => testTelegram(config))

  ipcMain.handle('preferences:get', () => appData.preferences)

  ipcMain.handle('preferences:save', async (_, prefs: AppData['preferences']) => {
    appData.preferences = prefs
    saveData(appData)
    return true
  })

  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('app:reset', async () => {
    resetData()
    appData = loadData()
    return true
  })

  ipcMain.handle('k8s:pod:describe', async (_, serverId: string, namespace: string, pod: string) => {
    try {
      const res = await sshManager.execCommand(serverId, COMMANDS.kubernetes.podDescribe(namespace, pod))
      return res.stdout
    } catch { return '' }
  })

  // hours defaults to 24; max clamped to 7*24=168
  ipcMain.handle('metrics:history', (_, serverId: string, hours: number = 24) => {
    const clamped = Math.min(Math.max(1, hours), 168)
    return metricsDb.query(serverId, clamped)
  })
}
