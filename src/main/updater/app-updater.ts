import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { is } from '@electron-toolkit/utils'
import { appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'

export type UpdaterStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'uptodate'
  | 'error'

export interface UpdaterState {
  status: UpdaterStatus
  currentVersion: string
  version?: string
  percent?: number
  message?: string
  releaseNotes?: string
  lastCheckedAt?: number
}

type Operation = 'idle' | 'background-check' | 'manual-check' | 'download' | 'install'

const FIRST_CHECK_DELAY_MS = 12_000
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

let state: UpdaterState = { status: 'idle', currentVersion: '' }
let operation: Operation = 'idle'
let initialized = false
let listenersRegistered = false
let installAfterDownload = false
let installationStarted = false
let checkInterval: ReturnType<typeof setInterval> | null = null
let firstCheckTimer: ReturnType<typeof setTimeout> | null = null

function updaterLog(level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', message: unknown): void {
  const line = `[${new Date().toISOString()}] [${level}] ${String(message)}\n`
  if (level === 'ERROR') console.error(`[updater] ${String(message)}`)
  else if (level === 'WARN') console.warn(`[updater] ${String(message)}`)
  else console.info(`[updater] ${String(message)}`)

  try {
    const logsDirectory = app.getPath('logs')
    mkdirSync(logsDirectory, { recursive: true })
    appendFileSync(join(logsDirectory, 'updater.log'), line, 'utf8')
  } catch {
    // Logging must never interrupt the update flow.
  }
}

const logger = {
  info: (message?: unknown): void => updaterLog('INFO', message ?? ''),
  warn: (message?: unknown): void => updaterLog('WARN', message ?? ''),
  error: (message?: unknown): void => updaterLog('ERROR', message ?? ''),
  debug: (message?: unknown): void => updaterLog('DEBUG', message ?? '')
}

function broadcast(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('updater:status', { ...state })
  }
}

function transition(status: UpdaterStatus, patch: Omit<Partial<UpdaterState>, 'status' | 'currentVersion'> = {}): void {
  state = { currentVersion: state.currentVersion, status, ...patch }
  broadcast()
}

function normalizeReleaseNotes(notes: unknown): string | undefined {
  if (typeof notes === 'string') return notes.trim() || undefined
  if (!Array.isArray(notes)) return undefined

  const result = notes
    .map((item) => {
      if (!item || typeof item !== 'object') return ''
      const entry = item as { version?: unknown; note?: unknown }
      const note = typeof entry.note === 'string' ? entry.note.trim() : ''
      if (!note) return ''
      return typeof entry.version === 'string' ? `v${entry.version}\n${note}` : note
    })
    .filter(Boolean)
    .join('\n\n')

  return result || undefined
}

function beginInstall(): void {
  if (installationStarted) return
  installationStarted = true
  operation = 'install'
  transition('installing', {
    version: state.version,
    percent: 100,
    releaseNotes: state.releaseNotes,
    message: undefined,
    lastCheckedAt: state.lastCheckedAt
  })

  setTimeout(() => {
    try {
      autoUpdater.quitAndInstall(false, true)
    } catch (error) {
      installationStarted = false
      operation = 'idle'
      transition('error', {
        version: state.version,
        message: (error as Error).message,
        lastCheckedAt: state.lastCheckedAt
      })
    }
  }, 800)
}

function registerListeners(): void {
  if (listenersRegistered) return
  listenersRegistered = true

  autoUpdater.on('checking-for-update', () => {
    if (operation === 'manual-check') {
      transition('checking', { lastCheckedAt: state.lastCheckedAt })
    }
  })

  autoUpdater.on('update-available', (info) => {
    operation = 'idle'
    installAfterDownload = false
    installationStarted = false
    transition('available', {
      version: info.version,
      releaseNotes: normalizeReleaseNotes(info.releaseNotes),
      percent: undefined,
      message: undefined,
      lastCheckedAt: Date.now()
    })
  })

  autoUpdater.on('update-not-available', () => {
    operation = 'idle'
    transition('uptodate', {
      version: undefined,
      message: undefined,
      percent: undefined,
      lastCheckedAt: Date.now()
    })
  })

  autoUpdater.on('download-progress', (progress) => {
    operation = 'download'
    transition('downloading', {
      version: state.version,
      percent: Math.max(0, Math.min(100, Math.round(progress.percent))),
      releaseNotes: state.releaseNotes,
      lastCheckedAt: state.lastCheckedAt
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    operation = 'idle'
    transition('ready', {
      version: info.version,
      percent: 100,
      releaseNotes: state.releaseNotes,
      message: undefined,
      lastCheckedAt: state.lastCheckedAt
    })
    if (installAfterDownload) beginInstall()
  })

  autoUpdater.on('error', (error) => {
    const failedOperation = operation
    operation = 'idle'
    installAfterDownload = false
    installationStarted = false
    updaterLog('ERROR', error.stack ?? error.message)

    // A background connectivity failure should not interrupt the user with a
    // persistent error toast. Manual checks and user-started downloads should.
    if (failedOperation === 'background-check') {
      transition('idle', { lastCheckedAt: state.lastCheckedAt })
      return
    }

    transition('error', {
      version: state.version,
      message: error.message,
      lastCheckedAt: state.lastCheckedAt
    })
  })
}

async function runCheck(manual: boolean): Promise<void> {
  if (is.dev || operation === 'download' || operation === 'install') return
  operation = manual ? 'manual-check' : 'background-check'
  if (manual) transition('checking', { lastCheckedAt: state.lastCheckedAt })

  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    // electron-updater also emits `error`; only provide a fallback for clients
    // where that event did not transition the state.
    operation = 'idle'
    if (manual) {
      transition('error', {
        message: (error as Error).message,
        lastCheckedAt: state.lastCheckedAt
      })
    }
  }
}

export function getUpdaterState(): UpdaterState {
  return { ...state }
}

export function initAppUpdater(_window: BrowserWindow, currentVersion: string): void {
  if (initialized) {
    broadcast()
    return
  }
  state = { status: 'idle', currentVersion }
  broadcast()

  if (is.dev) return
  initialized = true

  autoUpdater.logger = logger
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.autoRunAppAfterInstall = true
  autoUpdater.allowPrerelease = false
  autoUpdater.fullChangelog = true

  registerListeners()
  firstCheckTimer = setTimeout(() => void runCheck(false), FIRST_CHECK_DELAY_MS)
  checkInterval = setInterval(() => void runCheck(false), CHECK_INTERVAL_MS)
}

export function stopAppUpdater(): void {
  if (firstCheckTimer) {
    clearTimeout(firstCheckTimer)
    firstCheckTimer = null
  }
  if (checkInterval) {
    clearInterval(checkInterval)
    checkInterval = null
  }
}

export async function checkForUpdates(): Promise<UpdaterState> {
  await runCheck(true)
  return getUpdaterState()
}

async function startDownload(installWhenReady: boolean): Promise<boolean> {
  if (is.dev || state.status !== 'available') return false
  installAfterDownload = installWhenReady
  operation = 'download'
  transition('downloading', {
    version: state.version,
    percent: 0,
    releaseNotes: state.releaseNotes,
    lastCheckedAt: state.lastCheckedAt
  })

  try {
    await autoUpdater.downloadUpdate()
    return true
  } catch (error) {
    operation = 'idle'
    installAfterDownload = false
    transition('error', {
      version: state.version,
      message: (error as Error).message,
      lastCheckedAt: state.lastCheckedAt
    })
    return false
  }
}

export function downloadUpdate(): Promise<boolean> {
  return startDownload(false)
}

export function updateAndInstall(): Promise<boolean> {
  return startDownload(true)
}

export function installUpdate(): boolean {
  if (is.dev || state.status !== 'ready') return false
  beginInstall()
  return true
}
