import { app, BrowserWindow, shell, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { initializeLicense } from './security/license-key'
import { getMachineId } from './security/machine-id'
import { setupIpcHandlers } from './ipc/ipc-handlers'
import { setupDevOpsHandlers } from './ipc/ipc-handlers-devops'
import { sshManager } from './ssh/ssh-manager'
import { systemMonitor } from './monitors/system-monitor'
import { dockerMonitor } from './monitors/docker-monitor'
import { kubernetesMonitor } from './monitors/kubernetes-monitor'
import { logStreamer } from './monitors/log-streamer'

let mainWindow: BrowserWindow | null = null
let licenseIsNew = false

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    backgroundColor: '#0a0a0f',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => { mainWindow = null })

  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize()
    else mainWindow?.maximize()
  })
  ipcMain.on('window:close', () => mainWindow?.close())
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.monitc.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const { key, isNew } = initializeLicense()
  licenseIsNew = isNew
  const mid = getMachineId()
  setupIpcHandlers(key, mid, isNew)
  setupDevOpsHandlers(key, mid)

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  systemMonitor.stopAll()
  dockerMonitor.stopAll()
  kubernetesMonitor.stopAll()
  logStreamer.stopAll()
  sshManager.disconnectAll()
})

