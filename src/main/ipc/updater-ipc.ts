import { ipcMain } from 'electron'
import {
  checkForUpdates,
  downloadUpdate,
  getUpdaterState,
  installUpdate
} from '../updater/app-updater'

export function registerUpdaterIpcHandlers(): void {
  ipcMain.handle('updater:getStatus', () => getUpdaterState())
  ipcMain.handle('updater:check', () => checkForUpdates())
  ipcMain.handle('updater:download', () => {
    downloadUpdate()
    return true
  })
  ipcMain.handle('updater:install', () => {
    installUpdate()
    return true
  })
}
