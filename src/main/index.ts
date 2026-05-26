import { app, BrowserWindow, shell, ipcMain, nativeImage } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { setupIpcHandlers } from './ipc/ipc-handlers'
import { setupDevOpsHandlers } from './ipc/ipc-handlers-devops'
import { sshManager } from './ssh/ssh-manager'
import { systemMonitor } from './monitors/system-monitor'
import { dockerMonitor } from './monitors/docker-monitor'
import { kubernetesMonitor } from './monitors/kubernetes-monitor'
import { logStreamer } from './monitors/log-streamer'
import { sshTerminalManager } from './ssh/ssh-terminal-manager'

let mainWindow: BrowserWindow | null = null

function getAppIcon(): Electron.NativeImage | undefined {
  const resourcesPath = is.dev
    ? join(__dirname, '../../resources')
    : process.resourcesPath

  if (process.platform === 'win32') {
    return nativeImage.createFromPath(join(resourcesPath, 'icon.ico'))
  }
  if (process.platform === 'linux') {
    return nativeImage.createFromPath(join(resourcesPath, 'icons', '512x512.png'))
  }
  // macOS: .icns — Electron otomatik alır, ama yine de set edebiliriz
  return nativeImage.createFromPath(join(resourcesPath, 'icon.icns'))
}

function createWindow(): void {
  const icon = getAppIcon()

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    backgroundColor: '#0a0a0f',
    icon,
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

  setupIpcHandlers()
  setupDevOpsHandlers()

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
  sshTerminalManager.stopAll()
  sshManager.disconnectAll()
})

