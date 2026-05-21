import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { encrypt, decrypt } from '../security/encryption'
import type { AppData } from './types'

const DATA_FILE = 'monitc-data.enc'

const DEFAULT_DATA: AppData = {
  servers: [],
  integrations: {
    smtp: null,
    whatsapp: null,
    telegram: null,
    github: null,
    gitlab: null
  },
  alertRules: [],
  preferences: {
    theme: 'dark',
    pollIntervals: {
      system: 5,
      docker: 10,
      kubernetes: 10
    },
    sidebarCollapsed: false,
    language: 'en'
  },
  projectLinks: []
}

function getDataFilePath(): string {
  return path.join(app.getPath('userData'), DATA_FILE)
}

function getTmpFilePath(): string {
  return path.join(app.getPath('userData'), DATA_FILE + '.tmp')
}

export function loadData(licenseKey: string, machineId: string): AppData {
  const filePath = getDataFilePath()
  if (!fs.existsSync(filePath)) return structuredClone(DEFAULT_DATA)
  try {
    const ciphertext = fs.readFileSync(filePath, 'utf8')
    const json = decrypt(ciphertext, licenseKey, machineId)
    const parsed = JSON.parse(json) as AppData
    return { ...structuredClone(DEFAULT_DATA), ...parsed }
  } catch {
    return structuredClone(DEFAULT_DATA)
  }
}

export function saveData(data: AppData, licenseKey: string, machineId: string): void {
  const json = JSON.stringify(data)
  const ciphertext = encrypt(json, licenseKey, machineId)
  const tmpPath = getTmpFilePath()
  const filePath = getDataFilePath()
  fs.writeFileSync(tmpPath, ciphertext, 'utf8')
  fs.renameSync(tmpPath, filePath)
}

export function resetData(licenseKey: string, machineId: string): void {
  saveData(structuredClone(DEFAULT_DATA), licenseKey, machineId)
}
