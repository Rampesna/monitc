import { BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { is } from '@electron-toolkit/utils'

export type UpdaterStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'uptodate'
  | 'error'

export interface UpdaterState {
  status: UpdaterStatus
  currentVersion: string
  version?: string
  percent?: number
  message?: string
  releaseNotes?: string
}

let mainWindow: BrowserWindow | null = null
let state: UpdaterState = { status: 'idle', currentVersion: '' }
let checkInterval: ReturnType<typeof setInterval> | null = null

function broadcast(): void {
  mainWindow?.webContents.send('updater:status', state)
}

function setState(patch: Partial<UpdaterState>): void {
  state = { ...state, ...patch }
  broadcast()
}

export function getUpdaterState(): UpdaterState {
  return state
}

export function initAppUpdater(window: BrowserWindow, currentVersion: string): void {
  mainWindow = window
  state = { status: 'idle', currentVersion }

  if (is.dev) {
    broadcast()
    return
  }

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = false

  autoUpdater.on('checking-for-update', () => {
    setState({ status: 'checking', message: undefined })
  })

  autoUpdater.on('update-available', (info) => {
    setState({
      status: 'available',
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
      message: undefined,
      percent: undefined
    })
  })

  autoUpdater.on('update-not-available', () => {
    setState({ status: 'uptodate', version: undefined, message: undefined, percent: undefined })
  })

  autoUpdater.on('download-progress', (progress) => {
    setState({
      status: 'downloading',
      percent: Math.round(progress.percent)
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    setState({
      status: 'ready',
      version: info.version,
      percent: 100,
      message: undefined
    })
  })

  autoUpdater.on('error', (err) => {
    setState({
      status: 'error',
      message: err.message
    })
  })

  const runCheck = (): void => {
    autoUpdater.checkForUpdates().catch((err: Error) => {
      setState({ status: 'error', message: err.message })
    })
  }

  setTimeout(runCheck, 12_000)
  checkInterval = setInterval(runCheck, 4 * 60 * 60 * 1000)
}

export function stopAppUpdater(): void {
  if (checkInterval) {
    clearInterval(checkInterval)
    checkInterval = null
  }
}

export async function checkForUpdates(): Promise<UpdaterState> {
  if (is.dev) return state
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    setState({ status: 'error', message: (err as Error).message })
  }
  return state
}

export function downloadUpdate(): void {
  if (is.dev) return
  autoUpdater.downloadUpdate().catch((err: Error) => {
    setState({ status: 'error', message: err.message })
  })
}

export function installUpdate(): void {
  if (is.dev) return
  autoUpdater.quitAndInstall(false, true)
}
