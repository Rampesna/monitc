import { ipcMain } from 'electron'
import {
  checkForUpdates,
  downloadUpdate,
  getUpdaterState,
  installUpdate,
  updateAndInstall
} from '../updater/app-updater'

export function registerUpdaterIpcHandlers(): void {
  ipcMain.handle('updater:getStatus', () => getUpdaterState())
  ipcMain.handle('updater:check', () => checkForUpdates())
  ipcMain.handle('updater:download', () => downloadUpdate())
  ipcMain.handle('updater:update', () => updateAndInstall())
  ipcMain.handle('updater:install', () => installUpdate())
}
